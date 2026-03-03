
document.addEventListener('DOMContentLoaded', () => {
    const ALL_SECTIONS = ['ai', 'prompts', 'study', 'prog', 'dev', 'apk', 'sys', 'osint', 'ideas', 'fun', 'shop'];
    const MAX_FACETS_PER_SECTION = 3;
    const MAX_OPTIONS_PER_FACET = 6;

    const style = document.createElement('style');
    style.innerHTML = `
        .section-filter-bar {
            position: relative;
            z-index: 80;
        }
        .custom-select-container {
            position: relative;
            min-width: 140px;
            z-index: 80;
        }
        .custom-select-container.open {
            z-index: 90;
        }
        .custom-select-trigger {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 8px 12px;
            font-size: 12px;
            color: #94a3b8;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
        }
        .custom-select-trigger:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.2);
            color: #f1f5f9;
        }
        .custom-select-trigger.active {
            border-color: #a855f7;
            color: #fff;
            background: rgba(168, 85, 247, 0.1);
        }
        .custom-select-options {
            position: absolute;
            top: calc(100% + 8px);
            left: 0;
            width: 100%;
            background: #0a0a0c;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 12px;
            overflow: hidden;
            z-index: 120;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-10px);
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            max-height: 200px;
            overflow-y: auto;
        }
        .custom-select-container.open .custom-select-options {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .custom-option {
            padding: 10px 12px;
            font-size: 12px;
            color: #cbd5e1;
            cursor: pointer;
            transition: background 0.2s;
        }
        .custom-option:hover {
            background: rgba(168, 85, 247, 0.2);
            color: white;
        }
        .custom-option.selected {
            background: rgba(168, 85, 247, 0.3);
            color: white;
            font-weight: 600;
        }
        .custom-select-options::-webkit-scrollbar { width: 4px; }
        .custom-select-options::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
    `;
    document.head.appendChild(style);

    const FACET_DEFINITIONS = [
        { key: 'format', label: '', detector: detectFormat },
        { key: 'focus', label: '', detector: detectFocus },
        { key: 'platform', label: '', detector: detectPlatform },
        { key: 'source', label: '', detector: detectSource },
        { key: 'model', label: '', detector: detectModel }
    ];

    class AdvancedSectionFilter {
        constructor(sectionId) {
            this.sectionId = sectionId;
            this.sectionElement = document.getElementById(sectionId);
            if (!this.sectionElement) return;

            this.resources = [];
            this.activeFilters = {};
            this.searchTerm = '';
            this.init();
        }

        init() {
            this.extractResources();
            if (this.resources.length === 0) return;
            const availableFacets = this.analyzeFacets();
            if (availableFacets.length === 0) return;
            this.createUI(availableFacets);
        }

        extractResources() {
            const cards = this.sectionElement.querySelectorAll('.glass-card');
            this.resources = Array.from(cards).map(card => {
                const title = (card.querySelector('h3')?.innerText || '').trim();
                const desc = (card.querySelector('p')?.innerText || '').trim();
                const xmp = (card.querySelector('xmp')?.innerText || '').trim();
                const link = card.querySelector('a')?.getAttribute('href') || '';
                const badge = (card.querySelector('span')?.innerText || '').trim();
                const fullText = `${title} ${desc} ${xmp}`.toLowerCase();

                const facets = {};
                FACET_DEFINITIONS.forEach(def => {
                    const values = def.detector(fullText, link, badge);
                    facets[def.key] = Array.isArray(values) ? values : (values ? [values] : []);
                });

                return { element: card, fullText, facets };
            });
        }

        analyzeFacets() {
            const facetStats = FACET_DEFINITIONS.map(def => {
                const counts = new Map();
                let tagged = 0;
                this.resources.forEach(res => {
                    const values = res.facets[def.key];
                    if (!values || values.length === 0) return;
                    tagged += 1;
                    values.forEach(val => {
                        counts.set(val, (counts.get(val) || 0) + 1);
                    });
                });
                const distinct = counts.size;
                return { def, counts, distinct, tagged };
            });

            const usable = facetStats
                .filter(f => f.distinct >= 2)
                .sort((a, b) => {
                    if (b.distinct !== a.distinct) return b.distinct - a.distinct;
                    return b.tagged - a.tagged;
                })
                .slice(0, MAX_FACETS_PER_SECTION)
                .map(f => {
                    const options = Array.from(f.counts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, MAX_OPTIONS_PER_FACET)
                        .map(([val]) => val);
                    return { key: f.def.key, label: f.def.label, options };
                });

            return usable;
        }

        createUI(availableFacets) {
            const filterBar = document.createElement('div');
            filterBar.className = 'w-full mb-8 reveal active section-filter-bar';

            const searchHTML = `
                <div class="relative flex-1 min-w-[220px]">
                    <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
                    <input type="text" placeholder="Поиск в категории..." 
                        class="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-gray-300 focus:border-purple-500/50 focus:outline-none transition-all section-search backdrop-blur-sm">
                </div>
            `;

            const dropdownsHTML = availableFacets.map(f => this.createCustomDropdownHTML(f)).join('');

            const resetHTML = `
                <button class="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl px-4 py-3 text-gray-400 hover:text-white transition-all section-reset flex items-center gap-2 group" title="Сбросить фильтры">
                    <i class="fas fa-undo text-xs group-hover:-rotate-180 transition-transform duration-500"></i>
                </button>
            `;

            filterBar.innerHTML = `
                <div class="flex flex-col md:flex-row gap-4 items-start md:items-center">
                    ${searchHTML}
                    <div class="flex flex-wrap gap-3 w-full md:w-auto">
                        ${dropdownsHTML}
                        ${resetHTML}
                    </div>
                </div>
            `;

            const grid = this.sectionElement.querySelector('.grid');
            if (grid) {
                this.sectionElement.insertBefore(filterBar, grid);
            } else {
                this.sectionElement.appendChild(filterBar);
            }

            this.bindEvents(filterBar);
        }

        createCustomDropdownHTML(facet) {
            const optionsHTML = facet.options.map(v => `<div class="custom-option" data-value="${v}">${v}</div>`).join('');
            return `
                <div class="custom-select-container" data-facet="${facet.key}">
                    <div class="custom-select-trigger">
                        <span>${facet.label}</span>
                        <i class="fas fa-chevron-down text-[10px] ml-2 opacity-50"></i>
                    </div>
                    <div class="custom-select-options custom-scrollbar">
                        <div class="custom-option selected" data-value="all">Все ${facet.label}</div>
                        ${optionsHTML}
                    </div>
                </div>
            `;
        }

        bindEvents(container) {
            const searchInput = container.querySelector('.section-search');
            searchInput.addEventListener('input', e => {
                this.searchTerm = e.target.value.toLowerCase();
                this.applyFilters();
            });

            const dropdowns = container.querySelectorAll('.custom-select-container');

            document.addEventListener('click', e => {
                if (!e.target.closest('.custom-select-container')) {
                    dropdowns.forEach(d => d.classList.remove('open'));
                }
            });

            dropdowns.forEach(dropdown => {
                const trigger = dropdown.querySelector('.custom-select-trigger');
                const facet = dropdown.dataset.facet;
                const triggerSpan = trigger.querySelector('span');
                const facetLabel = dropdown.querySelector('.custom-option[data-value="all"]')?.innerText.replace(/^Все\s/, '') || '';

                trigger.addEventListener('click', e => {
                    e.stopPropagation();
                    dropdowns.forEach(d => {
                        if (d !== dropdown) d.classList.remove('open');
                    });
                    dropdown.classList.toggle('open');
                });

                dropdown.querySelectorAll('.custom-option').forEach(opt => {
                    opt.addEventListener('click', e => {
                        e.stopPropagation();
                        const val = opt.dataset.value;
                        if (val === 'all') {
                            delete this.activeFilters[facet];
                            triggerSpan.innerText = facetLabel;
                            trigger.classList.remove('active');
                        } else {
                            this.activeFilters[facet] = val;
                            triggerSpan.innerText = val;
                            trigger.classList.add('active');
                        }
                        dropdown.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                        opt.classList.add('selected');
                        dropdown.classList.remove('open');
                        this.applyFilters();
                    });
                });
            });

            const resetBtn = container.querySelector('.section-reset');
            resetBtn.addEventListener('click', () => {
                this.activeFilters = {};
                this.searchTerm = '';
                searchInput.value = '';
                dropdowns.forEach(d => {
                    const label = d.querySelector('.custom-option[data-value="all"]')?.innerText.replace(/^Все\s/, '') || '';
                    d.querySelector('.custom-select-trigger span').innerText = label;
                    d.querySelector('.custom-select-trigger').classList.remove('active');
                    d.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    d.querySelector('.custom-option[data-value="all"]').classList.add('selected');
                    d.classList.remove('open');
                });
                this.applyFilters();
            });
        }

        applyFilters() {
            this.resources.forEach(res => {
                const matchesSearch = this.searchTerm === '' || res.fullText.includes(this.searchTerm);
                let matchesFacets = true;
                for (const [facet, activeValue] of Object.entries(this.activeFilters)) {
                    const values = res.facets[facet] || [];
                    if (!values.includes(activeValue)) {
                        matchesFacets = false;
                        break;
                    }
                }
                if (matchesSearch && matchesFacets) {
                    res.element.style.display = 'block';
                    requestAnimationFrame(() => res.element.classList.add('active'));
                } else {
                    res.element.style.display = 'none';
                    res.element.classList.remove('active');
                }
            });
        }
    }

    function detectFormat(text, link, badge) {
        const tags = [];
        if (text.includes('prompt') || text.includes('промпт') || text.includes('prompting')) tags.push('Промпты');
        if (text.includes('course') || text.includes('курс') || text.includes('обуч') || text.includes('tutorial')) tags.push('Курс');
        if (text.includes('presentation') || text.includes('презентац') || text.includes('slides') || text.includes('ppt')) tags.push('Презентации');
        if (text.includes('image') || text.includes('картин') || text.includes('photo') || text.includes('logo') || text.includes('upscale')) tags.push('Изображения');
        if (text.includes('video') || text.includes('видео') || text.includes('movie') || text.includes('youtube')) tags.push('Видео');
        if (text.includes('audio') || text.includes('музык') || text.includes('sound') || text.includes('voice') || text.includes('podcast')) tags.push('Аудио');
        if (text.includes('pdf')) tags.push('PDF');
        if (text.includes('extension') || text.includes('chrome') || text.includes('расширение')) tags.push('Расширение');
        if (text.includes('bot') || text.includes('чат-бот') || text.includes('chatbot')) tags.push('Бот');
        if (text.includes('app') || text.includes('apk') || text.includes('ios') || text.includes('android')) tags.push('Приложение');
        if (link && link.includes('github.com')) tags.push('Репозиторий');
        return unique(tags);
    }

    function detectFocus(text) {
        const tags = [];
        if (text.includes('osint') || text.includes('security') || text.includes('vpn') || text.includes('privacy') || text.includes('hack') || text.includes('взлом')) tags.push('Безопасность');
        if (text.includes('design') || text.includes('ui') || text.includes('ux') || text.includes('logo')) tags.push('Дизайн');
        if (text.includes('code') || text.includes('dev') || text.includes('library') || text.includes('api') || text.includes('github')) tags.push('Разработка');
        if (text.includes('study') || text.includes('learn') || text.includes('курс') || text.includes('обуч') || text.includes('tutorial')) tags.push('Обучение');
        if (text.includes('research') || text.includes('paper') || text.includes('citation') || text.includes('конспект')) tags.push('Исследования');
        if (text.includes('automation') || text.includes('productivity') || text.includes('plan') || text.includes('notes')) tags.push('Продуктивность');
        if (text.includes('video') || text.includes('audio') || text.includes('image')) tags.push('Медиа');
        return unique(tags);
    }

    function detectPlatform(text, link, badge) {
        const tags = [];
        const badgeText = (badge || '').toLowerCase();
        if (badgeText.includes('android') || text.includes('android')) tags.push('Android');
        if (badgeText.includes('ios') || text.includes('ios')) tags.push('iOS');
        if (text.includes('windows')) tags.push('Windows');
        if (text.includes('linux')) tags.push('Linux');
        if (text.includes('mac') || text.includes('macos')) tags.push('macOS');
        if (link && link.includes('chromewebstore.google.com')) tags.push('Chrome');
        if (tags.length === 0 && link && (link.startsWith('http://') || link.startsWith('https://'))) tags.push('Web');
        return unique(tags);
    }

    function detectSource(text, link) {
        if (!link || link === '#') return [];
        const domain = extractDomain(link);
        const tags = [];
        if (domain.includes('github.com')) tags.push('GitHub');
        if (domain.includes('t.me') || domain.includes('telegram.me')) tags.push('Telegram');
        if (domain.includes('chromewebstore.google.com')) tags.push('Chrome Store');
        if (domain.includes('huggingface.co')) tags.push('HuggingFace');
        if (domain.includes('openai.com')) tags.push('OpenAI');
        if (domain.includes('google')) tags.push('Google');
        if (domain.includes('app') || domain.includes('cloud') || domain.includes('ai')) tags.push('Web App');
        if (tags.length === 0) tags.push('Веб');
        return unique(tags);
    }

    function detectModel(text) {
        const tags = [];
        if (text.includes('gpt') || text.includes('openai')) tags.push('GPT');
        if (text.includes('claude')) tags.push('Claude');
        if (text.includes('gemini')) tags.push('Gemini');
        if (text.includes('llama')) tags.push('Llama');
        if (text.includes('qwen')) tags.push('Qwen');
        if (text.includes('mistral')) tags.push('Mistral');
        return unique(tags);
    }

    function extractDomain(url) {
        try {
            const clean = url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
            return clean;
        } catch {
            return '';
        }
    }

    function unique(arr) {
        return Array.from(new Set(arr));
    }

    ALL_SECTIONS.forEach(id => new AdvancedSectionFilter(id));
});
