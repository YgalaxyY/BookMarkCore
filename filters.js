
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
        .custom-select-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border-radius: 6px;
            background: rgba(168, 85, 247, 0.15);
            color: #c4b5fd;
            font-size: 10px;
            margin-right: 8px;
        }
        .custom-select-label {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .custom-tooltip {
            position: relative;
        }
        .custom-tooltip::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: calc(100% + 10px);
            left: 0;
            background: rgba(15, 15, 20, 0.95);
            color: #e2e8f0;
            padding: 8px 10px;
            border-radius: 10px;
            font-size: 11px;
            white-space: nowrap;
            opacity: 0;
            visibility: hidden;
            transform: translateY(6px);
            transition: all 0.2s ease;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
            z-index: 200;
        }
        .custom-tooltip:hover::after {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .section-group {
            margin-top: 20px;
        }
        .section-group-title {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: #94a3b8;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .section-group-title::before {
            content: '';
            width: 18px;
            height: 2px;
            background: linear-gradient(90deg, #9333ea, transparent);
            border-radius: 4px;
        }
        .empty-state {
            background: rgba(15, 15, 20, 0.6);
            border: 1px dashed rgba(255, 255, 255, 0.12);
            border-radius: 20px;
            padding: 28px;
            text-align: center;
            color: #cbd5e1;
            backdrop-filter: blur(12px);
        }
        .empty-state h4 {
            font-size: 16px;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 6px;
        }
        .empty-state p {
            font-size: 12px;
            color: #94a3b8;
        }
        .empty-state button {
            margin-top: 12px;
            padding: 8px 14px;
            border-radius: 12px;
            background: rgba(168, 85, 247, 0.2);
            color: #e9d5ff;
            border: 1px solid rgba(168, 85, 247, 0.3);
            font-size: 12px;
        }
    `;
    document.head.appendChild(style);

    const FACET_META = {
        format: { label: 'Формат', icon: 'fa-layer-group', tooltip: 'Тип и формат ресурса' },
        focus: { label: 'Направление', icon: 'fa-compass', tooltip: 'Сфера применения и задача' },
        platform: { label: 'Платформа', icon: 'fa-mobile-screen-button', tooltip: 'ОС или среда использования' },
        source: { label: 'Источник', icon: 'fa-globe', tooltip: 'Где размещен ресурс' },
        model: { label: 'Модель', icon: 'fa-brain', tooltip: 'Модель или семейство ИИ' }
    };

    const FACET_DEFINITIONS = [
        { key: 'format', detector: detectFormat },
        { key: 'focus', detector: detectFocus },
        { key: 'platform', detector: detectPlatform },
        { key: 'source', detector: detectSource },
        { key: 'model', detector: detectModel }
    ];

    class AdvancedSectionFilter {
        constructor(sectionId) {
            this.sectionId = sectionId;
            this.sectionElement = document.getElementById(sectionId);
            if (!this.sectionElement) return;

            this.resources = [];
            this.activeFilters = {};
            this.searchTerm = '';
            this.groupMap = new Map();
            this.emptyStateEl = null;
            this.init();
        }

        init() {
            this.extractResources();
            if (this.resources.length === 0) {
                this.renderEmptyState('Пока нет ресурсов', 'Добавьте первый ресурс, и он появится здесь.');
                return;
            }
            const availableFacets = this.analyzeFacets();
            if (availableFacets.length === 0) {
                this.createUI([]);
                this.applyGrouping();
                return;
            }
            this.createUI(availableFacets);
            this.applyGrouping();
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
                    const meta = FACET_META[f.def.key] || { label: f.def.key, icon: 'fa-filter', tooltip: '' };
                    return { key: f.def.key, label: meta.label, icon: meta.icon, tooltip: meta.tooltip, options };
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
            this.emptyStateEl = this.createEmptyStateElement();
        }

        createCustomDropdownHTML(facet) {
            const label = facet.label || 'Фильтр';
            const defaultLabel = `${label}: Все`;
            const optionsHTML = facet.options.map(v => `<div class="custom-option" data-value="${v}">${v}</div>`).join('');
            const tooltip = facet.tooltip || '';
            const icon = facet.icon || 'fa-filter';
            return `
                <div class="custom-select-container" data-facet="${facet.key}" data-default-label="${defaultLabel}">
                    <div class="custom-select-trigger custom-tooltip" data-tooltip="${tooltip}">
                        <span class="custom-select-label">
                            <span class="custom-select-icon"><i class="fas ${icon}"></i></span>
                            <span>${defaultLabel}</span>
                        </span>
                        <i class="fas fa-chevron-down text-[10px] ml-2 opacity-50"></i>
                    </div>
                    <div class="custom-select-options custom-scrollbar">
                        <div class="custom-option selected" data-value="all">${defaultLabel}</div>
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
                const triggerSpan = trigger.querySelector('.custom-select-label span:last-child');
                const facetLabel = dropdown.dataset.defaultLabel || 'Все';

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
                    const label = d.dataset.defaultLabel || 'Все';
                    d.querySelector('.custom-select-label span:last-child').innerText = label;
                    d.querySelector('.custom-select-trigger').classList.remove('active');
                    d.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                    d.querySelector('.custom-option[data-value="all"]').classList.add('selected');
                    d.classList.remove('open');
                });
                this.applyFilters();
            });
        }

        applyFilters() {
            let visibleCount = 0;
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
                    visibleCount += 1;
                } else {
                    res.element.style.display = 'none';
                    res.element.classList.remove('active');
                }
            });
            this.updateGroupVisibility();
            this.toggleEmptyState(visibleCount === 0);
        }

        applyGrouping() {
            const grid = this.sectionElement.querySelector('.grid');
            if (!grid) return;
            const groupKey = 'format';
            const groups = new Map();

            this.resources.forEach(res => {
                const values = res.facets[groupKey] || [];
                const label = values.length > 0 ? values[0] : 'Другое';
                if (!groups.has(label)) {
                    const groupEl = document.createElement('div');
                    groupEl.className = 'section-group';
                    groupEl.dataset.group = label;
                    groupEl.innerHTML = `
                        <div class="section-group-title">${label}</div>
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
                    `;
                    groups.set(label, groupEl);
                }
                groups.get(label).querySelector('.grid').appendChild(res.element);
            });

            const wrapper = document.createElement('div');
            wrapper.className = 'section-groups';
            Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([_, el]) => wrapper.appendChild(el));
            grid.replaceWith(wrapper);
            this.groupMap = groups;
        }

        updateGroupVisibility() {
            if (!this.groupMap || this.groupMap.size === 0) return;
            this.groupMap.forEach(groupEl => {
                const cards = groupEl.querySelectorAll('.glass-card');
                const anyVisible = Array.from(cards).some(card => card.style.display !== 'none');
                groupEl.style.display = anyVisible ? 'block' : 'none';
            });
        }

        createEmptyStateElement() {
            let el = this.sectionElement.querySelector('.empty-state');
            if (el) return el;
            el = document.createElement('div');
            el.className = 'empty-state';
            el.innerHTML = `
                <h4>Пока пусто</h4>
                <p>Добавьте новые ресурсы — они появятся здесь автоматически.</p>
                <button type="button">Добавить ресурс</button>
            `;
            const target = this.sectionElement.querySelector('.section-groups') || this.sectionElement.querySelector('.grid');
            if (target) target.before(el);
            else this.sectionElement.appendChild(el);
            el.style.display = 'none';
            return el;
        }

        renderEmptyState(title, subtitle) {
            this.createEmptyStateElement();
            if (this.emptyStateEl) {
                this.emptyStateEl.querySelector('h4').innerText = title;
                this.emptyStateEl.querySelector('p').innerText = subtitle;
                this.emptyStateEl.style.display = 'block';
            }
        }

        toggleEmptyState(show) {
            if (!this.emptyStateEl) return;
            this.emptyStateEl.style.display = show ? 'block' : 'none';
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
