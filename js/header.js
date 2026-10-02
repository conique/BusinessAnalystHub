/* Cabeçalho padrão do BAHUB — usado em todas as páginas.
   Cada página define (opcionalmente): window.aoBuscar(texto) e window.aoNovoRegistro(). */
(function () {
    const topo = document.getElementById('topo');
    if (!topo) return;
    const atual = topo.dataset.atual || '';

    topo.innerHTML = `
        <div class="topo-esq">
            <a class="marca-ba" href="index.html" title="Início">BA</a>
            <nav class="migalha" id="migalha" aria-label="Navegação"></nav>
        </div>
        <div class="topo-dir">
            <label class="busca">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
                <input id="topo-busca" type="search" placeholder="Buscar demandas..." autocomplete="off">
            </label>
            <button class="btn-novo" id="topo-novo" type="button">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>
                <span>Novo Registro</span>
            </button>
        </div>`;

    /* Sistema de pastas: Workspace é a pasta base; dentro dela ficam os projetos.
       Na pasta base, "Workspace" é o local atual. Dentro de um projeto, vira link. */
    const migalha = document.getElementById('migalha');
    function montarMigalha(nomePasta) {
        migalha.innerHTML = '';
        const sep = () => { const e = document.createElement('span'); e.className = 'sep'; e.textContent = '/'; return e; };
        migalha.appendChild(sep());
        if (!nomePasta) {
            const raiz = document.createElement('span');
            raiz.className = 'migalha-atual';
            raiz.textContent = 'Workspace';
            migalha.appendChild(raiz);
            return;
        }
        const link = document.createElement('a');
        link.className = 'migalha-link';
        link.href = 'index.html';
        link.textContent = 'Workspace';
        const atualEl = document.createElement('span');
        atualEl.className = 'migalha-atual';
        atualEl.textContent = nomePasta;
        migalha.append(link, sep(), atualEl);
    }
    montarMigalha(atual);

    document.getElementById('topo-busca').addEventListener('input', e => {
        if (typeof window.aoBuscar === 'function') window.aoBuscar(e.target.value.trim().toLowerCase());
    });
    document.getElementById('topo-novo').addEventListener('click', () => {
        if (typeof window.aoNovoRegistro === 'function') window.aoNovoRegistro();
    });

    window.BAHUB_Topo = { definirAtual: montarMigalha };
})();