/* Cabeçalho padrão do BAHUB — usado em todas as páginas.
   Cada página define (opcionalmente): window.aoBuscar(texto) e window.aoNovoRegistro().
   Com data-simples="true" no <header>, mostra só a logo e o caminho (sem busca nem botão). */
(function () {
    const topo = document.getElementById('topo');
    if (!topo) return;
    const atual = topo.dataset.atual || '';
    const simples = topo.dataset.simples === 'true';

    topo.innerHTML = `
        <div class="topo-esq">
            <a class="marca-ba" href="index.html" data-pasta="" data-drop-pasta="" title="Início">BA</a>
            <nav class="migalha" id="migalha" aria-label="Navegação"></nav>
        </div>
        <div class="topo-dir${simples ? ' solo' : ''}">
            <button class="btn-tema" id="topo-tema" type="button"></button>
            ${simples ? '' : '<span class="topo-visao" id="topo-visao" hidden></span>'}
            ${simples ? '' : `<label class="busca">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                <input id="topo-busca" type="search" placeholder="Buscar páginas..." autocomplete="off">
            </label>
            <button class="btn-novo" id="topo-novo" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>
                <span>Nova Página</span>
            </button>`}
            ${simples ? '' : `<button class="btn-novo" id="topo-nova-pasta" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10v8M8 14h8"></path><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
                <span>Nova pasta</span>
            </button>`}
        </div>`;

    /* Sistema de pastas: Workspace é a pasta base; dentro dela ficam os projetos.
       Na pasta base, "Workspace" é o local atual. Dentro de um projeto, vira link. */
    const migalha = document.getElementById('migalha');
    /* Caminho em pastas: segmentos = [{ nome, href?, pasta? }]; o último (sem href) é o local atual.
       Os links levam data-drop-pasta, para soltar itens arrastados em cima deles. */
    function montarCaminho(segs) {
        migalha.innerHTML = '';
        const sep = () => { const e = document.createElement('span'); e.className = 'sep'; e.textContent = '/'; return e; };
        migalha.appendChild(sep());
        if (!segs.length) {
            const raiz = document.createElement('span');
            raiz.className = 'migalha-atual';
            raiz.textContent = 'Workspace';
            migalha.appendChild(raiz);
            return;
        }
        const raizLink = document.createElement('a');
        raizLink.className = 'migalha-link';
        raizLink.href = 'index.html';
        raizLink.dataset.pasta = '';
        raizLink.dataset.dropPasta = '';
        raizLink.textContent = 'Workspace';
        migalha.appendChild(raizLink);
        segs.forEach(s => {
            migalha.appendChild(sep());
            if (s.href) {
                const l = document.createElement('a');
                l.className = 'migalha-link';
                l.href = s.href;
                if (s.pasta) { l.dataset.pasta = s.pasta; l.dataset.dropPasta = s.pasta; }
                l.textContent = s.nome;
                migalha.appendChild(l);
            } else {
                const c = document.createElement('span');
                c.className = 'migalha-atual';
                c.textContent = s.nome;
                migalha.appendChild(c);
            }
        });
    }
    function montarMigalha(nomePasta) { montarCaminho(nomePasta ? [{ nome: nomePasta }] : []); }
    montarMigalha(atual);

    const busca = document.getElementById('topo-busca'), novo = document.getElementById('topo-novo');
    const novaPasta = document.getElementById('topo-nova-pasta');
    if (busca) busca.addEventListener('input', e => {
        if (typeof window.aoBuscar === 'function') window.aoBuscar(e.target.value.trim().toLowerCase());
    });
    if (novo) novo.addEventListener('click', () => {
        if (typeof window.aoNovoRegistro === 'function') window.aoNovoRegistro();
    });
    if (novaPasta) novaPasta.addEventListener('click', () => {
        if (typeof window.aoNovaPasta === 'function') window.aoNovaPasta();
    });

    /* Modo claro / escuro (a escolha fica salva neste navegador). */
    const ICONE_SOL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
    const ICONE_LUA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';
    const btnTema = document.getElementById('topo-tema');
    function atualizarBotaoTema() {
        const claro = document.documentElement.dataset.tema === 'claro';
        btnTema.innerHTML = claro ? ICONE_LUA : ICONE_SOL;
        btnTema.title = claro ? 'Ativar modo escuro' : 'Ativar modo claro';
        btnTema.setAttribute('aria-label', btnTema.title);
    }
    btnTema.addEventListener('click', () => {
        const novo = document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro';
        document.documentElement.dataset.tema = novo;
        try { localStorage.setItem('bahub_tema', novo); } catch (e) { /* sem armazenamento */ }
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = novo === 'claro' ? '#f1f5f9' : '#111827';
        atualizarBotaoTema();
    });
    atualizarBotaoTema();

    window.BAHUB_Topo = { definirAtual: montarMigalha, definirCaminho: montarCaminho };
})();