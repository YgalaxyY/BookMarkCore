import os
import json
import uuid
import sys
import re
import asyncio
import base64
import html
import time
import ast
import gc
import logging
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from aiohttp import web
from github import Github, Auth
from huggingface_hub import InferenceClient
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from dotenv import load_dotenv

# --- 1. НАСТРОЙКИ И ОКРУЖЕНИЕ ---
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

TG_TOKEN = os.getenv("TG_TOKEN")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
HF_TOKEN = os.getenv("HF_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID", 0)) 
REPO_NAME = "YgalaxyY/BookMarkCore"
FILE_PATH = "index.html"

# Каскад моделей
AI_MODELS_QUEUE = [
    "Qwen/Qwen2.5-72B-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
    "mistralai/Mistral-Nemo-Instruct-2407"
]

if not all([TG_TOKEN, GITHUB_TOKEN, HF_TOKEN]):
    logger.warning("Tokens missing via .env (Check Render Environment)")

class ToolForm(StatesGroup):
    wait_link = State()
    confirm_duplicate = State()
    select_category = State()

bot = Bot(token=TG_TOKEN)
dp = Dispatcher(storage=MemoryStorage())
auth = Auth.Token(GITHUB_TOKEN)
gh = Github(auth=auth)

# --- МИДЛВАРЬ: ПРОВЕРКА НА АДМИНА ---
@dp.message.outer_middleware()
async def admin_middleware(handler, event: types.Message, data: dict):
    if ADMIN_ID and event.from_user.id != ADMIN_ID:
        logger.warning(f"Unauthorized access from: {event.from_user.id}")
        await event.answer("🚫 Доступ запрещен. Я подчиняюсь только своему создателю.")
        return 
    return await handler(event, data)


# --- 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И РАБОТА С БАЗОЙ ---

def extract_url_from_text(text):
    urls = re.findall(r'(https?://[^\s<>")\]]+|www\.[^\s<>")\]]+)', text)
    clean_urls = []
    for u in urls:
        u = u.rstrip(').,;]')
        if "t.me" in u or "telegram.me" in u:
            if re.search(r'\/[\w_]+\/\d+', u):
                clean_urls.append(u)
            continue
        clean_urls.append(u)
    return clean_urls[0] if clean_urls else "MISSING"

def clean_and_parse_json(raw_response):
    text = raw_response.strip()
    json_block = re.search(r'```json\s*(\{.*?\})\s*```', text, re.DOTALL)
    if json_block:
        text = json_block.group(1)
    else:
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            text = text[start:end+1]

    text = re.sub(r',\s*}', '}', text)
    text = re.sub(r',\s*]', ']', text)

    try: return json.loads(text)
    except json.JSONDecodeError: pass 
    try: return ast.literal_eval(text)
    except Exception: return None

def normalize_url(url):
    if url in ["MISSING", "#", ""]: return url
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    clean_query = {k: v for k, v in query.items() if not k.startswith('utm_')}
    parsed = parsed._replace(query=urlencode(clean_query, doseq=True))
    return urlunparse(parsed).rstrip('/')

def fetch_db_context():
    """
    Скачивает сайт с GitHub и превращает его в текстовую базу знаний для ИИ.
    """
    try:
        repo = gh.get_repo(REPO_NAME)
        contents = repo.get_contents(FILE_PATH, ref="main")
        html_content = contents.decoded_content.decode("utf-8")
        
        card_blocks = html_content.split('class="glass-card')[1:]
        db_items = []
        
        for block in card_blocks:
            title_match = re.search(r'<h3[^>]*>(.*?)</h3>', block)
            desc_match = re.search(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)
            xmp_match = re.search(r'<xmp>(.*?)</xmp>', block, re.DOTALL)
            link_match = re.search(r'<a href="([^"]+)"', block)
            
            if title_match:
                title = re.sub(r'<[^>]+>', '', title_match.group(1).strip())
                desc = re.sub(r'<[^>]+>', '', desc_match.group(1).strip()) if desc_match else ""
                
                extra = ""
                if xmp_match:
                    extra = f"\n  Текст промпта: {xmp_match.group(1).strip()}"
                elif link_match:
                    extra = f"\n  Ссылка: {link_match.group(1)}"
                    
                db_items.append(f"Название: {title}\nОписание: {desc}{extra}\n---")
                
        return "\n".join(db_items) if db_items else "База данных пока пуста."
    except Exception as e:
        logger.error(f"Error fetching DB context: {e}")
        return "Ошибка доступа к базе данных."

# --- 3. МОЗГИ БОТА (ЭВРИСТИКА + ИИ) ---

def fallback_heuristic_analysis(text):
    logger.warning("🔧 AI Failed completely. Using Fallback logic.")
    prompt_markers = [
        '<Role>', '<System>', '<Context>', '<Instructions>', '<Output_Format>',
        '<Роль>', '<Система>', '<Контекст>', '<Инструкции>', 
        'Act as a', 'You are a', 'Представь, что ты', 
        'Напиши промпт', 'System prompt:', 'Промт:', 'Prompt:'
    ]
    
    if any(marker in text for marker in prompt_markers):
        start_idx = len(text)
        for marker in prompt_markers:
            idx = text.find(marker)
            if idx != -1 and idx < start_idx: start_idx = idx
        
        prompt_body = text[start_idx:].strip() if start_idx < len(text) else text
        lines = [line.strip() for line in text.split('\n') if len(line.strip()) > 10 and "http" not in line and "t.me" not in line]
        title = lines[0][:60] + "..." if lines else "AI Prompt"

        return {
            "section": "prompts", "name": title, "desc": "System Prompt (Auto-detected)",
            "url": "#", "platform": "", "prompt_body": prompt_body,
            "confidence": 100, "alternative": None,
            "reply_text": "ИИ перегружен, но я сам распознал промпт! Сохраняю 📝"
        }

    url = extract_url_from_text(text)
    lines = [line.strip() for line in text.split('\n') if len(line.strip()) > 5]
    title = lines[0][:50] + "..." if lines else "New Resource"

    if "github.com" in url:
        return {"section": "dev", "name": title, "desc": "GitHub Repo", "url": url, "prompt_body": "", "confidence": 100, "alternative": None, "reply_text": "Репозиторий на GitHub! Добавляю в разработку 💻"}
    
    return {"section": "ideas", "name": title, "desc": text[:100]+"...", "url": url if url != "MISSING" else "#", "prompt_body": "", "confidence": 50, "alternative": None, "reply_text": "Нейросети недоступны, сохраняю как идею 💡"}

async def analyze_content_full_cycle(text, status_msg: types.Message):
    hard_found_url = extract_url_from_text(text)
    is_url_present = hard_found_url != "MISSING"

    system_prompt = (
        "### ROLE: Galaxy Intelligence Core (Charismatic AI Assistant)\n\n"
        "### TASK: Analyze content and respond as a living assistant\n\n"
        "### CATEGORY LOGIC (Check strict order):\n"
        "1. 'osint' (SECURITY): Hacking, exploits, pentesting, privacy, leaks.\n"
        "2. 'prompts' (TEXT INPUTS): The actual text meant to be typed into ChatGPT.\n"
        "3. 'sys' (SYSTEM): Windows/Linux tools, cleaners, drivers.\n"
        "4. 'apk' (MOBILE): Apps for Android/iOS.\n"
        "5. 'study' (EDUCATION): Tutorials, research, slide creators.\n"
        "6. 'dev' (CODE): Libraries, APIs, Web-builders.\n"
        "7. 'shop' (COMMERCE): Goods, prices.\n"
        "8. 'fun' (LEISURE): Games, movies.\n"
        "9. 'ai' (GENERAL AI): News, models. (If not Study/Dev/Prompts).\n"
        "10. 'prog' (SYNTAX): Code snippets.\n"
        "11. 'ideas' (FALLBACK): General notes.\n"
        "12. 'chat' (CONVERSATION): User says 'Hello', 'Thanks', or asks a general question. ACTION: Do not save, just reply in 'reply_text'.\n\n"
        "### CHAIN OF THOUGHT: First think, then answer!\n"
        "### OUTPUT JSON:\n"
        "{\n"
        "  \"thought_process\": \"Brief analysis...\",\n"
        "  \"section\": \"category\",\n"
        "  \"alternative\": \"alt_category_or_none\",\n"
        "  \"confidence\": 90,\n"
        "  \"name\": \"Title\",\n"
        "  \"desc\": \"Summary\",\n"
        "  \"url\": \"Link or 'none'\",\n"
        "  \"platform\": \"Android/iOS/none\",\n"
        "  \"prompt_body\": \"Full prompt text or 'none'\",\n"
        "  \"reply_text\": \"Living response to user (Russian)\"\n"
        "}\n"
        "### RULES: Double quotes JSON. Escape inner quotes using \\\". No empty fields."
    )

    user_prompt = f"ANALYZE:\n{text[:8000]}\nURL: {hard_found_url}"
    
    for model_name in AI_MODELS_QUEUE:
        short_model = model_name.split('/')[-1]
        try:
            await status_msg.edit_text(f"🧠 <i>Думаю через {short_model}...</i>", parse_mode=ParseMode.HTML)
        except TelegramBadRequest: pass

        try:
            client = InferenceClient(model=model_name, token=HF_TOKEN)
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.chat_completion,
                    messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                    max_tokens=4000, temperature=0.1
                ), timeout=25.0
            )
            data = clean_and_parse_json(response.choices[0].message.content.strip())
            
            if data:
                ai_url = data.get('url', '')
                if str(ai_url).lower() in ["none", "missing", "", "#"]:
                     data['url'] = hard_found_url if is_url_present else "#"
                
                for key in ['platform', 'prompt_body', 'alternative']:
                    if data.get(key) in ['none', None]: data[key] = None
                
                if 'confidence' not in data: data['confidence'] = 100
                return data
            
        except asyncio.TimeoutError:
            try: await status_msg.edit_text(f"⚠️ <i>{short_model} завис. Переключаюсь...</i>", parse_mode=ParseMode.HTML)
            except TelegramBadRequest: pass
            continue
        except Exception:
            await asyncio.sleep(1)
            continue 

    return fallback_heuristic_analysis(text)


# --- 4. ГЕНЕРАЦИЯ HTML ---
def generate_card_html(data):
    s = str(data.get('section', 'ai')).lower()
    name = html.escape(str(data.get('name', 'Resource')))
    url = str(data.get('url', '#'))
    desc = html.escape(str(data.get('desc', 'No description.')))
    p_body = str(data.get('prompt_body', '')).replace('</xmp>', '')
    platform = html.escape(str(data.get('platform', 'App')))

    meta = {
        "ideas":  {"icon": "lightbulb", "color": "yellow"}, "fun": {"icon": "gamepad", "color": "pink"},
        "shop":   {"icon": "cart-shopping", "color": "rose"}, "ai": {"icon": "robot", "color": "purple"},
        "prompts":{"icon": "key", "color": "amber"}, "study": {"icon": "graduation-cap", "color": "indigo"},
        "prog":   {"icon": "code", "color": "blue"}, "dev": {"icon": "flask", "color": "emerald"},
        "apk":    {"icon": "mobile-screen", "color": "green"}, "sys": {"icon": "microchip", "color": "cyan"},
        "osint":  {"icon": "eye", "color": "red"},
    }
    style = meta.get(s, meta["ai"])
    color = style["color"]
    icon = style["icon"]

    if s == 'prompts':
        p_id = f"p-{uuid.uuid4().hex[:6]}"
        return f"""
        <div class="glass-card p-8 rounded-[2rem] border-l-4 border-{color}-500 mb-6 reveal active relative overflow-hidden group">
            <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <i class="fas fa-{icon} text-6xl text-{color}-500"></i>
            </div>
            <div class="relative z-10">
                <div class="flex justify-between items-center mb-4">
                    <div>
                        <span class="text-[9px] font-black text-{color}-400 tracking-widest uppercase">AI PROMPT</span>
                        <h3 class="text-xl font-bold text-white mt-1">{name}</h3>
                    </div>
                    <button onclick="copyToClipboard('{p_id}-text')" class="bg-white/5 hover:bg-{color}-500/20 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2">
                        <i class="fas fa-copy"></i> Copy
                    </button>
                </div>
                <div class="bg-black/30 rounded-xl p-4 border border-white/5">
                    <div id="{p_id}-text" class="text-xs text-gray-300 font-mono leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar"><xmp>{p_body}</xmp></div>
                </div>
                <p class="text-gray-500 text-xs mt-3 italic">{desc}</p>
            </div>
        </div>
        """
    
    if s == 'apk':
        return f"""
        <div class="glass-card p-8 rounded-[2rem] hover:bg-white/5 transition-all duration-300 reveal active border-t border-white/5 mb-6">
            <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-2xl bg-{color}-500/10 flex items-center justify-center shrink-0 border border-{color}-500/20"><i class="fas fa-{icon} text-{color}-400 text-lg"></i></div>
                <div class="flex-1">
                    <div class="flex justify-between items-start">
                        <h3 class="text-lg font-bold text-gray-100 leading-tight mb-2">{name}</h3>
                        <span class="text-[9px] font-bold bg-{color}-500 text-black px-2 py-0.5 rounded uppercase tracking-wider">{platform}</span>
                    </div>
                    <p class="text-sm text-gray-400 leading-relaxed mb-4">{desc}</p>
                    <a href="{url}" target="_blank" class="inline-flex items-center gap-2 text-xs font-bold text-white hover:text-{color}-400 transition-colors group">DOWNLOAD <i class="fas fa-download group-hover:translate-y-1 transition-transform"></i></a>
                </div>
            </div>
        </div>
        """

    return f"""
    <div class="glass-card p-8 rounded-[2rem] hover:bg-white/5 transition-all duration-300 reveal active border-t border-white/5 mb-6">
        <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-2xl bg-{color}-500/10 flex items-center justify-center shrink-0 border border-{color}-500/20"><i class="fas fa-{icon} text-{color}-400 text-lg"></i></div>
            <div class="flex-1">
                <div class="flex justify-between items-start">
                    <h3 class="text-lg font-bold text-gray-100 leading-tight mb-2">{name}</h3>
                    <span class="text-[9px] font-bold bg-{color}-500/20 text-{color}-300 px-2 py-1 rounded uppercase tracking-wider">{s}</span>
                </div>
                <p class="text-sm text-gray-400 leading-relaxed mb-4">{desc}</p>
                <a href="{url}" target="_blank" class="inline-flex items-center gap-2 text-xs font-bold text-white hover:text-{color}-400 transition-colors group">OPEN RESOURCE <i class="fas fa-arrow-right group-hover:translate-x-1 transition-transform"></i></a>
            </div>
        </div>
    </div>
    """

# --- 5. ЗАПИСЬ НА GITHUB ---

def sync_push_to_github(data, force=False):
    try:
        repo = gh.get_repo(REPO_NAME)
        branch = "main" 
        contents = repo.get_contents(FILE_PATH, ref=branch)
        html_content = contents.decoded_content.decode("utf-8")

        target_url = data.get('url', '')
        clean_target = normalize_url(target_url)
        
        if not force and clean_target and clean_target not in ["#", "MISSING", ""]:
            if clean_target in html_content: return "DUPLICATE"
            name = html.escape(str(data.get('name', '')))
            if name and name in html_content: return "DUPLICATE"

        sec_key = str(data.get('section', 'ai')).upper()
        target_marker = f"<!-- INSERT_{sec_key}_HERE -->"
        if target_marker not in html_content: return "MARKER_ERROR"

        new_card = generate_card_html(data)
        new_html = html_content.replace(target_marker, f"{new_card}\n{target_marker}")

        repo.update_file(contents.path, f"Add: {data.get('name')} [{sec_key}] via GalaxyBot", new_html, contents.sha, branch)
        return "OK"
    except Exception as e:
        return "GIT_ERROR"


# --- 6. TELEGRAM HANDLERS ---

# --- НОВАЯ ФИЧА: ПОИСК ПО БАЗЕ (ИСПРАВЛЕННАЯ С КАСКАДОМ И HTML) ---
@dp.message(F.text.startswith('/ask') | F.text.startswith('?'))
async def ask_database_handler(message: types.Message):
    query = message.text.replace('/ask', '').lstrip('?').strip()
    if not query:
        await message.reply("📝 Напиши вопрос, например:\n<code>? найди нейросеть для презентаций</code>", parse_mode=ParseMode.HTML)
        return

    await bot.send_chat_action(chat_id=message.chat.id, action="typing")
    status_msg = await message.answer("🔍 <i>Инициализация поиска по базе...</i>", parse_mode=ParseMode.HTML)
    
    # 1. Достаем базу знаний с сайта
    db_context = await asyncio.to_thread(fetch_db_context)
    
    # 2. НОВЫЙ "ЖИВОЙ" ПРОМПТ ДЛЯ ПОИСКА (Строгий запрет Markdown, только HTML)
    system_prompt = (
        "Ты — Galaxy OS Assistant, живой, эрудированный и невероятно харизматичный ИИ-напарник.\n"
        "Твоя задача — помочь создателю, найдя ВСЕ подходящие инструменты или промпты в его личной базе знаний.\n\n"
        "БАЗА ЗНАНИЙ СОЗДАТЕЛЯ:\n"
        f"{db_context}\n\n"
        "ПРАВИЛА ОТВЕТА (КРИТИЧЕСКИ ВАЖНО):\n"
        "1. Найди ВСЕ релевантные записи. Не ограничивайся одной!\n"
        "2. ЗАПРЕЩЕНО использовать Markdown-символы (#, *, _, `). Форматируй текст ТОЛЬКО с помощью простых HTML тегов: <b>жирный</b>, <i>курсив</i>, <a href='ссылка'>текст ссылки</a>.\n"
        "3. Общайся как живой человек. Структурируй ответ абзацами и эмодзи (🔹, 💡, 🚀).\n"
        "4. Если нашел сервисы: органично вплети их названия в текст, объясни, чем они помогут, и дай ссылки через HTML тег <a>.\n"
        "5. Если нашел промпт: просто выведи его текст четко и понятно (без тегов кода).\n"
        "6. Общайся на 'ты', будь дружелюбным и энергичным.\n"
        "7. Если в базе нет ответа, так и скажи, но предложи смежную идею."
    )
    
    success = False
    
    # 3. КАСКАД МОДЕЛЕЙ (Чтобы бот не падал, если HF перегружен)
    for model_name in AI_MODELS_QUEUE:
        short_model = model_name.split('/')[-1]
        try:
            await status_msg.edit_text(f"🔍 <i>Сканирую базу через {short_model}...</i>", parse_mode=ParseMode.HTML)
        except TelegramBadRequest:
            pass # Игнорируем, если текст не изменился
            
        try:
            client = InferenceClient(model=model_name, token=HF_TOKEN)
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.chat_completion,
                    messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": query}],
                    max_tokens=3000, 
                    temperature=0.3
                ), timeout=40.0 # Увеличил время ожидания до 40 сек
            )
            answer = response.choices[0].message.content.strip()
            
            # Отправляем ответ в HTML (самый безопасный вариант для Telegram)
            try:
                await status_msg.edit_text(answer, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
            except TelegramBadRequest as e:
                # Если ИИ все же накосячил с HTML, отправляем голый текст без форматирования, чтобы не потерять ответ
                logger.error(f"HTML Parse error: {e}")
                await status_msg.edit_text(answer, disable_web_page_preview=True)
            
            success = True
            break # Успешно ответили, выходим из цикла
            
        except asyncio.TimeoutError:
            logger.warning(f"Timeout with {model_name} in /ask")
            continue
        except Exception as e:
            logger.error(f"Error with {model_name} in /ask: {e}")
            continue
            
    if not success:
        await status_msg.edit_text("❌ Все нейросети сейчас перегружены (Hugging Face не отвечает). База слишком большая, попробуй спросить через минуту.")

# ... (Остальные хендлеры: process_category_selection, process_duplicate_decision, manual_link_handler остаются как были) ...
@dp.callback_query(F.data.startswith("cat_"), ToolForm.select_category)
async def process_category_selection(callback: types.CallbackQuery, state: FSMContext):
    selected_cat = callback.data.split("_")[1]
    state_data = await state.get_data()
    tool_data = state_data.get('tool_data')
    if not tool_data:
        await callback.message.edit_text("❌ Данные устарели.")
        await state.clear()
        return
    tool_data['section'] = selected_cat
    await callback.message.edit_text(f"👌 Выбрано: **{selected_cat.upper()}**. Деплою...")
    result = await asyncio.to_thread(sync_push_to_github, tool_data)
    if result == "OK": await callback.message.edit_text(f"✅ Добавлено в `{selected_cat.upper()}`!")
    else: await callback.message.edit_text(f"❌ Ошибка (код: {result}).")
    await state.clear()

@dp.callback_query(F.data.in_({"dup_yes", "dup_no"}), ToolForm.confirm_duplicate)
async def process_duplicate_decision(callback: types.CallbackQuery, state: FSMContext):
    state_data = await state.get_data()
    tool_data = state_data.get('tool_data')
    if not tool_data:
        await callback.message.edit_text("❌ Данные устарели.")
        await state.clear()
        return
    if callback.data == "dup_no":
        await callback.message.edit_text("🙅‍♂️ Отмена.")
        await state.clear()
    else:
        await callback.message.edit_text("🚀 Force Push...")
        result = await asyncio.to_thread(sync_push_to_github, tool_data, force=True)
        if result == "OK": await callback.message.edit_text(f"✅ Добавлено (Force)!")
        else: await callback.message.edit_text(f"❌ Ошибка.")
        await state.clear()

@dp.message(ToolForm.wait_link)
async def manual_link_handler(message: types.Message, state: FSMContext):
    state_data = await state.get_data()
    if 'tool_data' not in state_data:
        await message.answer("❌ Данные потеряны (Бот перезагрузился).")
        await state.clear()
        return
    user_link = message.text.strip()
    tool_data = state_data['tool_data']
    tool_data['url'] = "#" if user_link == "#" else user_link
    status = await message.answer(f"🔗 Ссылка принята. Деплою **{tool_data['name']}**...")
    result = await asyncio.to_thread(sync_push_to_github, tool_data)
    if result == "OK":
        await status.edit_text(f"✅ **{tool_data['name']}** успешно добавлен!")
        await state.clear()
    elif result == "DUPLICATE":
        keyboard = types.InlineKeyboardMarkup(inline_keyboard=[
            [types.InlineKeyboardButton(text="✅ Добавить", callback_data="dup_yes")],
            [types.InlineKeyboardButton(text="❌ Отмена", callback_data="dup_no")]
        ])
        await state.update_data(tool_data=tool_data)
        await state.set_state(ToolForm.confirm_duplicate)
        await status.edit_text(f"⚠️ Дубликат! Добавить?", reply_markup=keyboard)
    else:
        await status.edit_text(f"❌ Ошибка.")
        await state.clear()

@dp.message(StateFilter(None), F.text | F.caption)
async def main_content_handler(message: types.Message, state: FSMContext):
    try:
        content = message.text or message.caption or ""
        
        if re.match(r'^https?://\S+$', content.strip()):
            await message.reply("⚠️ Это просто ссылка. Если это дополнение к посту, то я потерял контекст. Пожалуйста, отправь пост целиком.")
            return

        if len(content.strip()) < 5: return

        await bot.send_chat_action(chat_id=message.chat.id, action="typing")
        status_msg = await message.answer("🌌 <i>Инициализация сканирования...</i>", parse_mode=ParseMode.HTML)
        
        data = await analyze_content_full_cycle(content, status_msg)

        if not data:
            await status_msg.edit_text("❌ Критическая ошибка анализа.")
            return

        section = str(data.get('section', 'ai')).lower()
        bot_reply = data.get('reply_text', f"🚀 Готовлю деплой {data.get('name', 'Unknown')}...")
        
        # --- НОВАЯ ФИЧА: ОБЫЧНЫЙ ЧАТ ---
        # Если ИИ понял, что это просто разговор или вопрос без тега /ask
        if section == 'chat':
            await status_msg.edit_text(f"💬 {bot_reply}\n\n<i>💡 P.S. Если хочешь найти что-то в сохраненной базе, используй команду <b>/ask [твой вопрос]</b> или начни сообщение с вопроса (?).</i>", parse_mode=ParseMode.HTML)
            return

        confidence = data.get('confidence', 100)
        alt_section = data.get('alternative')
        name = data.get('name', 'Unknown')
        url = str(data.get('url', ''))
        
        if confidence < 80 and alt_section and alt_section != section:
            keyboard = types.InlineKeyboardMarkup(inline_keyboard=[
                [
                    types.InlineKeyboardButton(text=f"📂 {section.upper()}", callback_data=f"cat_{section}"),
                    types.InlineKeyboardButton(text=f"📂 {alt_section.upper()}", callback_data=f"cat_{alt_section}")
                ],
                [types.InlineKeyboardButton(text="❌ Отмена", callback_data="dup_no")]
            ])
            await state.update_data(tool_data=data)
            await state.set_state(ToolForm.select_category)
            await status_msg.edit_text(f"🤔 <b>Сомнения</b> ({confidence}%)\nОбъект: <b>{name}</b>\n{bot_reply}", reply_markup=keyboard, parse_mode=ParseMode.HTML)
            return

        is_no_link = section in ['prompts', 'ideas', 'shop', 'fun']
        is_bad = (url in ["MISSING", "", "#", "None"] or "ygalaxyy" in url)

        if not is_no_link and is_bad:
            await state.update_data(tool_data=data)
            await state.set_state(ToolForm.wait_link)
            await status_msg.edit_text(f"🧐 <b>{name}</b> [{section.upper()}]\n💬 {bot_reply}\n⚠️ Пришли прямую ссылку на ресурс.", parse_mode=ParseMode.HTML)
        else:
            await status_msg.edit_text(f"💬 {bot_reply}\n⚙️ <i>Пушу на GitHub...</i>", parse_mode=ParseMode.HTML)
            result = await asyncio.to_thread(sync_push_to_github, data)
            
            if result == "OK": 
                await status_msg.edit_text(f"✅ <b>{name}</b>\n\n💬 {bot_reply}\n<i>Успешно загружено в базу!</i>", parse_mode=ParseMode.HTML)
            elif result == "DUPLICATE":
                keyboard = types.InlineKeyboardMarkup(inline_keyboard=[
                    [types.InlineKeyboardButton(text="✅ Добавить", callback_data="dup_yes")],
                    [types.InlineKeyboardButton(text="❌ Отмена", callback_data="dup_no")]
                ])
                await state.update_data(tool_data=data)
                await state.set_state(ToolForm.confirm_duplicate)
                await status_msg.edit_text(f"⚠️ Ссылка или название уже есть в базе. Дублировать?", reply_markup=keyboard)
            elif result == "MARKER_ERROR": 
                await status_msg.edit_text(f"❌ Нет метки HTML для раздела {section.upper()}.")
            else: 
                await status_msg.edit_text("❌ Ошибка API GitHub.")

    except Exception as e:
        logger.error(f"CRITICAL HANDLER ERROR: {e}")
    finally:
        gc.collect()

# --- WEB SERVER ---
async def health_check(request):
    return web.Response(text="Galaxy Bot is Alive!")

async def start_web_server():
    port = int(os.environ.get("PORT", 8080))
    app = web.Application()
    app.router.add_get('/', health_check)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    await site.start()
    logger.info(f"🌍 Web server started on port {port}")

async def main():
    logger.info("🚀 GALAXY INTELLIGENCE BOT ONLINE")
    await start_web_server()
    await bot.delete_webhook(drop_pending_updates=True)
    try:
        await dp.start_polling(bot)
    except Exception as e:
        logger.error(f"Polling error: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped by user")