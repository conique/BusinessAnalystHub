/* Planora — dados no Supabase por workspace, com cache local (localStorage + IndexedDB)
   Cada conta pode ter vários workspaces (Planora_workspaces); os dados de cada um ficam em
   Planora_workspace_data, e o cache local usa chaves com o id do workspace.
   A tabela antiga Planora_dados NÃO é alterada por este código (só é lida, uma vez, para
   trazer para um workspace quem ainda não foi copiado — veja MIGRAR_LEGADO_SOB_DEMANDA). */
const CHAVE_DB = 'Planora_db';
const CHAVE_PREFERENCIAS = 'Planora_preferencias';
const BUCKET = 'midias';
const PEND_FLAG = 'Planora_pendente';
const TABELA_WS = 'Planora_workspaces';
const TABELA_DADOS = 'Planora_workspace_data';
const TABELA_LEGADO = 'Planora_dados';          // somente leitura
const MIGRAR_LEGADO_SOB_DEMANDA = true;       // desligue quando a Planora_dados for aposentada
const SESSAO_WS = 'Planora_ws_ativo';           // sessionStorage: workspace aberto nesta aba
const ULTIMO_WS = 'Planora_ultimo_ws';          // localStorage: último workspace usado (por usuário)
let seq = 0;
let sb = null, usuario = null, versao = null, timer = null, fila = Promise.resolve(), ultimoStatus = '';
let workspaceAtual = null, listaWorkspaces = [];

/* Sem workspace ativo (modo local), as chaves continuam as de sempre. */
const sufixoWs = () => workspaceAtual ? ':' + workspaceAtual.id : '';
const chaveDb = () => CHAVE_DB + sufixoWs();
const chavePreferencias = () => CHAVE_PREFERENCIAS + sufixoWs();
const chavePend = () => PEND_FLAG + sufixoWs();
const nuvemAtiva = () => !!(sb && usuario && workspaceAtual);

function lerBancoDeDados() { return JSON.parse(localStorage.getItem(chaveDb())) || []; }
function lerPreferenciasBanco() {
    try {
        const preferencias = JSON.parse(localStorage.getItem(chavePreferencias()));
        if (preferencias && typeof preferencias === 'object' && !Array.isArray(preferencias)) return preferencias;
    } catch (e) { /* migra preferências antigas */ }

    const preferencias = {};
    const visao = localStorage.getItem('Planora_visao');
    if (visao === 'tabela' || visao === 'kanban') preferencias.visao = visao;
    try {
        const ordenacao = JSON.parse(localStorage.getItem('Planora_ordenacao'));
        if (ordenacao && ['nome', 'rotulo', 'area', 'prazo'].includes(ordenacao.tipo)) {
            preferencias.ordenacao = { tipo: ordenacao.tipo, dir: ordenacao.dir === -1 ? -1 : 1 };
        }
    } catch (e) { /* sem ordenação antiga salva */ }
    try {
        const colunas = JSON.parse(localStorage.getItem('Planora_kanban_colunas'));
        if (Array.isArray(colunas)) preferencias.kanbanColunas = colunas;
    } catch (e) { /* sem ordem antiga de colunas salva */ }
    localStorage.setItem(chavePreferencias(), JSON.stringify(preferencias));
    return preferencias;
}
function salvarPreferenciasBanco(preferencias) {
    if (!preferencias || typeof preferencias !== 'object' || Array.isArray(preferencias)) {
        throw new TypeError('As preferências precisam ser um objeto.');
    }
    localStorage.setItem(chavePreferencias(), JSON.stringify(preferencias));
    salvarBancoDeDados(lerBancoDeDados());
}
function carregarDadosPersistidos(dados) {
    const preferenciasLocais = lerPreferenciasBanco();
    if (Array.isArray(dados)) {
        localStorage.setItem(chaveDb(), JSON.stringify(dados));
        localStorage.setItem(chavePreferencias(), JSON.stringify(preferenciasLocais));
        sincronizarHistoricoComBanco();
        return true;
    }
    if (!dados || typeof dados !== 'object' || !Array.isArray(dados.itens)) {
        throw new Error('Os dados recebidos da nuvem têm um formato inválido.');
    }
    localStorage.setItem(chaveDb(), JSON.stringify(dados.itens));
    localStorage.setItem(chavePreferencias(), JSON.stringify(
        dados.preferencias && typeof dados.preferencias === 'object' && !Array.isArray(dados.preferencias)
            ? dados.preferencias
            : {}
    ));
    sincronizarHistoricoComBanco();
    return false;
}
function montarDadosPersistidos() {
    return { itens: lerBancoDeDados(), preferencias: lerPreferenciasBanco() };
}
const CHAVE_HISTORICO = 'Planora_historico';
const chaveHistorico = () => CHAVE_HISTORICO + sufixoWs();
const LIMITE_HISTORICO = 20;
let estadosHistorico = [];
let indiceHistorico = -1;
let aplicandoHistorico = false;
let erroPersistenciaHistorico = false;

function notificarHistorico() {
    window.dispatchEvent(new Event('Planora-historico-atualizado'));
}
function persistirHistorico() {
    try {
        sessionStorage.setItem(chaveHistorico(), JSON.stringify({
            estados: estadosHistorico,
            indice: indiceHistorico
        }));
        erroPersistenciaHistorico = false;
    } catch (erro) {
        if (!erroPersistenciaHistorico) {
            console.error('Não foi possível persistir o histórico de alterações nesta sessão:', erro);
            setStatus('Histórico temporário: limite de armazenamento atingido');
        }
        erroPersistenciaHistorico = true;
    }
}
function inicializarHistorico() {
    const estadoAtual = localStorage.getItem(chaveDb()) || '[]';
    try {
        const salvo = JSON.parse(sessionStorage.getItem(chaveHistorico()) || 'null');
        if (salvo && Array.isArray(salvo.estados)
            && salvo.estados.every(estado => typeof estado === 'string')
            && Number.isInteger(salvo.indice)
            && salvo.indice >= 0
            && salvo.indice < salvo.estados.length
            && salvo.estados[salvo.indice] === estadoAtual) {
            const inicio = Math.max(0, salvo.estados.length - LIMITE_HISTORICO);
            estadosHistorico = salvo.estados.slice(inicio);
            indiceHistorico = salvo.indice - inicio;
            if (indiceHistorico < 0) indiceHistorico = -1;
        }
    } catch (erro) {
        console.error('Não foi possível carregar o histórico de alterações:', erro);
    }
    if (indiceHistorico < 0) {
        estadosHistorico = [estadoAtual];
        indiceHistorico = 0;
        persistirHistorico();
    }
    notificarHistorico();
}
function registrarEstadoHistorico(estadoAnterior, estadoNovo) {
    if (estadoAnterior === estadoNovo) return;
    if (estadosHistorico[indiceHistorico] !== estadoAnterior) {
        estadosHistorico = [estadoAnterior];
        indiceHistorico = 0;
    }
    estadosHistorico = estadosHistorico.slice(0, indiceHistorico + 1);
    estadosHistorico.push(estadoNovo);
    if (estadosHistorico.length > LIMITE_HISTORICO) estadosHistorico.shift();
    indiceHistorico = estadosHistorico.length - 1;
    persistirHistorico();
    notificarHistorico();
}
function sincronizarHistoricoComBanco() {
    const estadoAtual = localStorage.getItem(chaveDb()) || '[]';
    if (estadosHistorico[indiceHistorico] === estadoAtual) return;
    estadosHistorico = [estadoAtual];
    indiceHistorico = 0;
    persistirHistorico();
    notificarHistorico();
}
function aplicarEstadoHistorico(indice) {
    const dados = JSON.parse(estadosHistorico[indice]);
    aplicandoHistorico = true;
    try {
        salvarBancoDeDados(dados);
    } finally {
        aplicandoHistorico = false;
    }
    indiceHistorico = indice;
    persistirHistorico();
    window.dispatchEvent(new CustomEvent('Planora-dados-restaurados', { detail: { dados } }));
    notificarHistorico();
}
window.Planora_Historico = {
    podeDesfazer: () => indiceHistorico > 0,
    podeRefazer: () => indiceHistorico >= 0 && indiceHistorico < estadosHistorico.length - 1,
    desfazer: () => {
        if (indiceHistorico > 0) aplicarEstadoHistorico(indiceHistorico - 1);
    },
    refazer: () => {
        if (indiceHistorico >= 0 && indiceHistorico < estadosHistorico.length - 1) aplicarEstadoHistorico(indiceHistorico + 1);
    }
};
function salvarBancoDeDados(dados) {
    const estadoAnterior = localStorage.getItem(chaveDb()) || '[]';
    const estadoNovo = JSON.stringify(dados);
    localStorage.setItem(chaveDb(), estadoNovo);
    if (!aplicandoHistorico) registrarEstadoHistorico(estadoAnterior, estadoNovo);
    if (nuvemAtiva()) { localStorage.setItem(chavePend(), '1'); seq++; }
    agendarEnvio();
}
function setStatus(t) {
    ultimoStatus = t;
    const e = document.getElementById('status-nuvem');
    if (!e) return;
    const estado = t.includes('Salvando') ? 'salvando'
        : t.includes('Erro') || t.includes('Conflito') || t.includes('limite') ? 'erro'
            : t.includes('Salvo na nuvem') ? 'salvo'
                : 'local';
    const descricoes = {
        salvando: 'Salvando alterações',
        salvo: 'Tudo salvo na nuvem',
        erro: t,
        local: t
    };
    const icone = estado === 'salvando'
        ? '<svg class="status-nuvem-spinner" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="32 12"></circle></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 16.2A4.5 4.5 0 0 0 18.5 7.4 6.5 6.5 0 0 0 6 9a4 4 0 0 0 .5 8H19"></path></svg>';
    e.dataset.estado = estado;
    e.title = descricoes[estado];
    e.setAttribute('aria-label', descricoes[estado]);
    e.innerHTML = icone;
}

/* ---------- envio com controle de conflito ---------- */
/* Envia já (use antes de trocar de página, para não perder o que acabou de salvar). */
function descarregarNuvem() {
    clearTimeout(timer);
    fila = fila.then(enviar);
    return fila;
}
function agendarEnvio() {
    if (!nuvemAtiva()) return;
    setStatus('Salvando...');
    clearTimeout(timer);
    timer = setTimeout(() => { fila = fila.then(enviar); }, 200);
}
/* Envio imediato (usado depois de arrastar linhas, para não depender do tempo de espera). */
function enviarAgora() {
    if (!nuvemAtiva()) return;
    clearTimeout(timer);
    setStatus('Salvando...');
    fila = fila.then(enviar);
}

/* Avisa antes de fechar/recarregar se ainda há alteração não enviada à nuvem. */
window.addEventListener('beforeunload', e => {
    if (nuvemAtiva() && localStorage.getItem(chavePend()) === '1') { e.preventDefault(); e.returnValue = ''; }
});

async function enviar() {
    if (!nuvemAtiva()) return false;
    const dados = montarDadosPersistidos();
    const minhaSeq = seq;
    const wid = workspaceAtual.id;
    try {
        let r;
        /* atualizado_em é o "número da versão" do controle de conflito: gravamos um valor novo a cada envio,
           sem depender de gatilho no banco. */
        const agora = new Date().toISOString();
        if (versao === null) {
            r = await sb.from(TABELA_DADOS).upsert({ workspace_id: wid, dados, atualizado_em: agora }, { onConflict: 'workspace_id' })
                .select('atualizado_em').single();
            if (r.error) throw r.error;
            versao = r.data.atualizado_em;
        } else {
            r = await sb.from(TABELA_DADOS).update({ dados, atualizado_em: agora })
                .eq('workspace_id', wid).eq('atualizado_em', versao).select('atualizado_em');
            if (r.error) throw r.error;
            if (!r.data.length) {
                setStatus('Conflito: recarregue a página');
                alert('Outro computador alterou os dados. Recarregue a página para ver a versão mais recente.\n\nSuas últimas alterações NÃO foram enviadas.');
                return false;
            }
            versao = r.data[0].atualizado_em;
        }
        if (minhaSeq === seq) localStorage.removeItem(chavePend());
        setStatus('Salvo na nuvem');
        return true;
    } catch (e) {
        console.error(e);
        setStatus('Erro ao salvar na nuvem');
        return false;
    }
}

/* ---------- login ---------- */
function telaLogin() {
    return new Promise(res => {
        const o = document.createElement('div');
        o.className = 'lg-overlay';
        document.body.appendChild(o);
        let modo = 'entrar', email = '', senha = '';
        const esc = t => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const q = s => o.querySelector(s);
        const msg = (t, ok) => { const m = q('.lg-msg'); m.textContent = t; m.className = 'lg-msg' + (ok ? ' ok' : ''); };
        const traduz = e => {
            const m = (e.message || '').toLowerCase();
            if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
            if (m.includes('rate limit') || e.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
            if (m.includes('password')) return 'A senha precisa ter no mínimo 6 caracteres.';
            if (m.includes('invalid') && m.includes('email')) return 'Digite um e-mail válido.';
            return 'Não foi possível concluir: ' + e.message;
        };
        const ocupado = (btn, on, txt) => { btn.disabled = on; if (txt) btn.textContent = txt; };
        const entrar = async (btn, txtBtn) => {
            ocupado(btn, true, 'Entrando...');
            const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
            ocupado(btn, false, txtBtn);
            if (error) {
                if ((error.message || '').toLowerCase().includes('not confirmed')) { modo = 'confirmar'; return desenhar('Seu e-mail ainda não foi confirmado. Abra o link que enviamos.'); }
                return msg(traduz(error));
            }
            o.remove(); res(data.session);
        };

        function desenhar(aviso) {
            if (modo === 'confirmar') {
                o.innerHTML = `<div class="lg-card">
                    <div class="lg-logo ok">✉</div><h2>Confira seu e-mail</h2>
                    <p class="lg-sub">Enviamos um link de confirmação para <strong>${esc(email)}</strong>.</p>
                    <ol class="lg-passos"><li>Abra o e-mail (olhe também o spam e a lixeira).</li><li>Clique no link de confirmação.</li><li>Volte aqui e toque em “Já confirmei”.</li></ol>
                    <p class="lg-msg" role="alert"></p>
                    <button class="lg-principal" id="lg-ja" type="button">Já confirmei, entrar</button>
                    <div class="lg-links"><button id="lg-reenviar" type="button">Reenviar e-mail</button><button id="lg-voltar" type="button">Voltar</button></div></div>`;
                if (aviso) msg(aviso);
                q('#lg-ja').onclick = () => entrar(q('#lg-ja'), 'Já confirmei, entrar');
                q('#lg-voltar').onclick = () => { modo = 'entrar'; desenhar(); };
                q('#lg-reenviar').onclick = async () => {
                    const b = q('#lg-reenviar');
                    b.disabled = true;
                    const { error } = await sb.auth.resend({ type: 'signup', email });
                    if (error) { b.disabled = false; return msg(traduz(error)); }
                    msg('E-mail reenviado. Confira sua caixa de entrada.', true);
                    let s = 60; const t = setInterval(() => { b.textContent = s > 0 ? `Reenviar em ${s--}s` : 'Reenviar e-mail'; if (s < 0) { clearInterval(t); b.disabled = false; } }, 1000);
                };
                return;
            }
            const criar = modo === 'criar', rot = criar ? 'Criar conta' : 'Entrar';
            o.innerHTML = `<div class="lg-card">
                <div class="lg-logo">BA</div>
                <h2>${criar ? 'Criar sua conta' : 'Bem-vindo de volta'}</h2>
                <p class="lg-sub">${criar ? 'Guarde seus projetos na nuvem e acesse de qualquer computador.' : 'Entre para acessar seus projetos em qualquer computador.'}</p>
                <div class="lg-abas"><button type="button" data-m="entrar" class="${criar ? '' : 'on'}">Entrar</button><button type="button" data-m="criar" class="${criar ? 'on' : ''}">Criar conta</button></div>
                <label>E-mail<input id="lg-email" type="email" autocomplete="username" placeholder="voce@empresa.com" value="${esc(email)}"></label>
                <label>Senha<input id="lg-senha" type="password" autocomplete="${criar ? 'new-password' : 'current-password'}" placeholder="Mínimo 6 caracteres"></label>
                ${criar ? '<label>Confirmar senha<input id="lg-senha2" type="password" autocomplete="new-password" placeholder="Repita a senha"></label>' : ''}
                <p class="lg-msg" role="alert"></p>
                <button class="lg-principal" id="lg-ok" type="button">${rot}</button></div>`;
            if (aviso) msg(aviso, true);
            o.querySelectorAll('.lg-abas button').forEach(b => b.onclick = () => { email = q('#lg-email').value.trim(); modo = b.dataset.m; desenhar(); });
            const enviar = async () => {
                email = q('#lg-email').value.trim(); senha = q('#lg-senha').value;
                if (!email || !senha) return msg('Preencha e-mail e senha.');
                if (!criar) return entrar(q('#lg-ok'), rot);
                if (senha.length < 6) return msg('A senha precisa ter no mínimo 6 caracteres.');
                if (senha !== q('#lg-senha2').value) return msg('As senhas não conferem.');
                const btn = q('#lg-ok'); ocupado(btn, true, 'Criando...');
                const { data, error } = await sb.auth.signUp({ email, password: senha });
                ocupado(btn, false, rot);
                if (error) return msg(traduz(error));
                if (data.session) { o.remove(); return res(data.session); }
                if (data.user && data.user.identities && data.user.identities.length === 0) { modo = 'entrar'; return desenhar('Este e-mail já tem conta. Digite sua senha para entrar.'); }
                modo = 'confirmar'; desenhar();
            };
            q('#lg-ok').onclick = enviar;
            o.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); }));
            q(criar || email ? '#lg-senha' : '#lg-email').focus();
        }
        desenhar();
    });
}
/* ---------- limpeza local (sair da conta) ---------- */
function limparCacheLocal() {
    const bases = [CHAVE_DB, CHAVE_PREFERENCIAS, PEND_FLAG];
    for (const k of Object.keys(localStorage)) {
        if (bases.some(b => k === b || k.startsWith(b + ':'))) localStorage.removeItem(k);
    }
    for (const k of Object.keys(sessionStorage)) {
        if (k === CHAVE_HISTORICO || k.startsWith(CHAVE_HISTORICO + ':') || k === SESSAO_WS) sessionStorage.removeItem(k);
    }
    localStorage.removeItem('Planora_visao');
    localStorage.removeItem('Planora_ordenacao');
    localStorage.removeItem('Planora_kanban_colunas');
}
/* Garante que nada pendente fique para trás antes de sair/trocar. Devolve true se está tudo na nuvem. */
async function garantirEnvioPendente() {
    clearTimeout(timer);
    await fila;
    if (!nuvemAtiva() || localStorage.getItem(chavePend()) !== '1') return true;
    return (await descarregarNuvem()) === true;
}
async function sairDaConta() {
    if (!sb || !usuario) {
        alert('A nuvem não está ativa, então não há conta para sair. Seus dados continuam salvos neste navegador.');
        return;
    }
    /* Só sai (e limpa o cache local) depois de confirmar que tudo foi para a nuvem. */
    if (!await garantirEnvioPendente()) {
        alert('Não foi possível confirmar o envio dos dados para a nuvem. Você NÃO foi desconectado, para não perder nada.');
        return;
    }
    await sb.auth.signOut();
    limparCacheLocal();
    location.reload();
}

/* ---------- workspaces ---------- */
const nomeWsValido = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const dataCurta = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); };

async function carregarWorkspaces() {
    const { data, error } = await sb.from(TABELA_WS).select('id,nome,created_at,legacy_user_id')
        .eq('owner_id', usuario.id).order('created_at', { ascending: true });
    if (error) throw error;
    const lista = data || [];
    if (lista.length) {   // só para mostrar "atualizado em" na tela inicial; não traz o conteúdo (dados)
        const r = await sb.from(TABELA_DADOS).select('workspace_id,atualizado_em').in('workspace_id', lista.map(w => w.id));
        if (!r.error) (r.data || []).forEach(x => { const w = lista.find(y => y.id === x.workspace_id); if (w) w.atualizado_em = x.atualizado_em; });
    }
    return lista;
}
async function criarWorkspace(nome, dadosIniciais) {
    nome = nomeWsValido(nome);
    if (!nome) throw new Error('Digite um nome para o workspace.');
    if (listaWorkspaces.some(w => w.nome.toLowerCase() === nome.toLowerCase())) throw new Error('Você já tem um workspace com esse nome.');
    const ws = { id: crypto.randomUUID(), owner_id: usuario.id, nome, created_at: new Date().toISOString() };
    const r = await sb.from(TABELA_WS).insert(ws).select('id,nome,created_at,legacy_user_id').single();
    if (r.error) throw r.error;
    const novo = r.data;
    const dados = dadosIniciais || { itens: [], preferencias: {} };
    const atualizado_em = new Date().toISOString();
    const d = await sb.from(TABELA_DADOS).insert({ workspace_id: novo.id, dados, atualizado_em });
    /* se esta segunda gravação falhar, o workspace existe sem dados; ao abrir, o primeiro envio cria a linha. */
    if (d.error) console.error('Workspace criado, mas os dados iniciais não foram gravados:', d.error);
    else novo.atualizado_em = atualizado_em;
    listaWorkspaces.push(novo);
    return novo;
}
/* Quem ainda não tem workspace "inicial" mas tem linha em Planora_dados (ex.: criou conta depois da cópia)
   ganha um workspace com os dados copiados sem transformação. Só LÊ Planora_dados. */
async function migrarLegadoSePreciso(lista) {
    if (!MIGRAR_LEGADO_SOB_DEMANDA || lista.some(w => w.legacy_user_id === usuario.id)) return null;
    const { data, error } = await sb.from(TABELA_LEGADO).select('dados,atualizado_em').eq('user_id', usuario.id).maybeSingle();
    if (error) { console.error('Não foi possível ler a tabela legada:', error); return null; }
    if (!data) return null;
    const ws = { id: crypto.randomUUID(), owner_id: usuario.id, nome: 'Workspace inicial', created_at: new Date().toISOString(), legacy_user_id: usuario.id };
    const r = await sb.from(TABELA_WS).insert(ws).select('id,nome,created_at,legacy_user_id').single();
    if (r.error) {
        if (r.error.code === '23505') return (await carregarWorkspaces()).find(w => w.legacy_user_id === usuario.id) || null;
        throw r.error;
    }
    const d = await sb.from(TABELA_DADOS).insert({ workspace_id: r.data.id, dados: data.dados, atualizado_em: data.atualizado_em || new Date().toISOString() });
    if (d.error) throw d.error;
    return r.data;
}
function workspaceDaSessao(lista) {
    try {
        const s = JSON.parse(sessionStorage.getItem(SESSAO_WS) || 'null');
        if (s && s.u === usuario.id) return lista.find(w => w.id === s.w) || null;
    } catch (e) { /* sem escolha anterior */ }
    return null;
}
function ehTelaWorkspaces() {
    return location.pathname.split('/').pop() === 'workspaces.html';
}
function retornoSeguroWorkspaces(valor) {
    try {
        const destino = new URL(valor || 'index.html', location.href);
        const pagina = destino.pathname.split('/').pop();
        if (destino.origin !== location.origin || !['index.html', 'cards.html'].includes(pagina)) return 'index.html';
        return destino.pathname + destino.search + destino.hash;
    } catch (e) {
        return 'index.html';
    }
}
function urlTelaWorkspaces(retorno) {
    return 'workspaces.html?return=' + encodeURIComponent(retornoSeguroWorkspaces(retorno));
}
function urlRetornoWorkspaces() {
    return retornoSeguroWorkspaces(new URLSearchParams(location.search).get('return'));
}
/* Caminho do primeiro acesso: dados que só existiam neste navegador (modo local, antes da nuvem). */
function dadosLocaisAntigos() {
    try {
        const itens = JSON.parse(localStorage.getItem(CHAVE_DB));
        if (!Array.isArray(itens) || !itens.length) return null;
        let preferencias = {};
        try { const p = JSON.parse(localStorage.getItem(CHAVE_PREFERENCIAS)); if (p && typeof p === 'object' && !Array.isArray(p)) preferencias = p; } catch (e) { /* padrão */ }
        return { itens, preferencias };
    } catch (e) { return null; }
}
/* Alterações que ficaram pendentes no cache da versão anterior (chaves sem id) vão para o workspace inicial. */
function adotarCachePendenteAntigo() {
    if (workspaceAtual.legacy_user_id !== usuario.id) return;
    if (localStorage.getItem(PEND_FLAG) !== '1' || localStorage.getItem(chaveDb()) !== null) return;
    const antigo = localStorage.getItem(CHAVE_DB);
    if (antigo === null) return;
    localStorage.setItem(chaveDb(), antigo);
    const pref = localStorage.getItem(CHAVE_PREFERENCIAS);
    if (pref !== null) localStorage.setItem(chavePreferencias(), pref);
    localStorage.setItem(chavePend(), '1');
    localStorage.removeItem(PEND_FLAG);
}
async function ativarWorkspace(ws, importouLocal) {
    workspaceAtual = ws;
    versao = null;
    try {
        sessionStorage.setItem(SESSAO_WS, JSON.stringify({ u: usuario.id, w: ws.id }));
        localStorage.setItem(ULTIMO_WS + ':' + usuario.id, ws.id);
    } catch (e) { /* sem armazenamento */ }
    adotarCachePendenteAntigo();
    inicializarHistorico();
    const { data, error } = await sb.from(TABELA_DADOS).select('dados,atualizado_em').eq('workspace_id', ws.id).maybeSingle();
    if (error) {
        console.error(error);
        sb = null; usuario = null; // não envia nada, para não sobrescrever a nuvem
        setStatus('Erro ao carregar da nuvem (somente leitura local)');
        return false;
    }
    if (data) {
        versao = data.atualizado_em;
        if (localStorage.getItem(chavePend()) === '1') {
            await enviar();   // havia alteração local ainda não enviada (ex.: trocou de página rápido)
        } else {
            const migrarFormato = carregarDadosPersistidos(data.dados);
            if (migrarFormato) {
                localStorage.setItem(chavePend(), '1');
                seq++;
                if (!await enviar()) return false;
            }
        }
    } else if (!await enviar()) {   // workspace sem linha de dados: cria a linha (vazia ou com o cache pendente)
        return false;
    }
    if (importouLocal) await sincronizarMidiasLocais();
    setStatus('Salvo na nuvem');
    reenviarPendentes();
    window.dispatchEvent(new Event('Planora-workspace-atualizado'));
    return true;
}
/* Troca de workspace: envia o que estiver pendente e recarrega na raiz do novo workspace.
   id = null volta para a tela de boas-vindas. */
async function trocarWorkspace(id) {
    if (!await garantirEnvioPendente()) {
        alert('Não foi possível confirmar o envio dos dados para a nuvem. Você continua neste workspace para não perder nada.');
        return false;
    }
    try {
        if (id) sessionStorage.setItem(SESSAO_WS, JSON.stringify({ u: usuario.id, w: id }));
        else sessionStorage.removeItem(SESSAO_WS);
    } catch (e) { /* sem armazenamento */ }
    location.href = id ? 'index.html' : urlTelaWorkspaces(location.pathname + location.search + location.hash);
    return true;
}
async function novoWorkspaceInterativo() {
    const nome = await pedirNomeWorkspace();
    if (!nome) return;
    try {
        const ws = await criarWorkspace(nome);
        await trocarWorkspace(ws.id);
    } catch (e) {
        console.error(e);
        alert('Não foi possível criar o workspace: ' + (e.message || e));
    }
}
async function renomearWorkspaceInterativo(id) {
    const ws = listaWorkspaces.find(w => w.id === id);
    if (!ws) throw new Error('Workspace não encontrado.');
    const nome = await pedirNovoNomeWorkspace(ws);
    if (!nome || nome === ws.nome) return false;
    if (listaWorkspaces.some(w => w.id !== id && w.nome.toLowerCase() === nome.toLowerCase())) {
        alert('Você já tem um workspace com esse nome.');
        return false;
    }
    const { data, error } = await sb.from(TABELA_WS).update({ nome })
        .eq('id', id).eq('owner_id', usuario.id).select('id,nome,created_at,legacy_user_id').single();
    if (error) throw error;
    const atualizado = listaWorkspaces.find(w => w.id === id);
    if (atualizado) atualizado.nome = data.nome;
    if (workspaceAtual && workspaceAtual.id === id) workspaceAtual.nome = data.nome;
    window.dispatchEvent(new Event('Planora-workspace-atualizado'));
    return true;
}
function itensParaTransferencia(dadosOrigem, indice) {
    const item = dadosOrigem[indice];
    if (!item || !item.id) return [];
    const ids = new Set();
    const fila = [item];
    while (fila.length) {
        const atual = fila.pop();
        if (!atual || ids.has(atual.id)) continue;
        ids.add(atual.id);
        dadosOrigem.filter(outro => outro && outro.pai === atual.id).forEach(outro => fila.push(outro));
    }
    return dadosOrigem.filter(um => ids.has(um.id));
}
async function transferirProjetoWorkspace(dadosOrigem, indice, destinoId) {
    if (!nuvemAtiva()) throw new Error('A conexão com a nuvem não está ativa.');
    const item = dadosOrigem[indice];
    if (!item || !item.id) throw new Error('Selecione um item válido.');
    if (!destinoId || destinoId === workspaceAtual.id) throw new Error('Escolha outro workspace.');
    if (!await garantirEnvioPendente()) throw new Error('Não foi possível salvar as alterações do workspace atual.');

    const transferidos = itensParaTransferencia(dadosOrigem, indice);
    const idsTransferidos = new Set(transferidos.map(item => item.id));
    const tipo = item.tipo === 'pasta' ? 'pasta' : 'projeto';

    const { data: linhaDestino, error: erroLeitura } = await sb.from(TABELA_DADOS)
        .select('dados,atualizado_em').eq('workspace_id', destinoId).maybeSingle();
    if (erroLeitura) throw erroLeitura;
    if (!linhaDestino) throw new Error('O workspace de destino ainda não tem uma linha de dados.');

    const dadosDestino = Array.isArray(linhaDestino.dados)
        ? { itens: linhaDestino.dados, preferencias: {} }
        : linhaDestino.dados;
    if (!dadosDestino || !Array.isArray(dadosDestino.itens)) {
        throw new Error('Os dados do workspace de destino têm um formato inválido.');
    }
    const conflitos = transferidos.filter(itemTransferido => dadosDestino.itens.some(itemDestino => itemDestino && itemDestino.id === itemTransferido.id));
    if (conflitos.length) {
        throw new Error(`Já existe ${tipo === 'pasta' ? 'uma pasta' : 'um projeto'} com este identificador no workspace de destino.`);
    }

    const itensDestino = dadosDestino.itens.concat(transferidos.map(itemTransferido => {
        const copia = JSON.parse(JSON.stringify(itemTransferido));
        copia.pai = idsTransferidos.has(copia.pai) ? copia.pai : null;
        return copia;
    }));
    const pacoteDestino = {
        itens: itensDestino,
        preferencias: dadosDestino.preferencias && typeof dadosDestino.preferencias === 'object'
            && !Array.isArray(dadosDestino.preferencias) ? dadosDestino.preferencias : {}
    };
    const versaoDestino = new Date().toISOString();
    let gravacao = sb.from(TABELA_DADOS).update({ dados: pacoteDestino, atualizado_em: versaoDestino })
        .eq('workspace_id', destinoId);
    gravacao = linhaDestino.atualizado_em === null
        ? gravacao.is('atualizado_em', null)
        : gravacao.eq('atualizado_em', linhaDestino.atualizado_em);
    const { data: linhasAtualizadas, error: erroDestino } = await gravacao.select('workspace_id');
    if (erroDestino) throw erroDestino;
    if (!linhasAtualizadas || !linhasAtualizadas.length) {
        throw new Error('O workspace de destino foi alterado em outra sessão. Atualize e tente novamente.');
    }
    const destino = listaWorkspaces.find(w => w.id === destinoId);
    if (destino) destino.atualizado_em = versaoDestino;

    const origemRestante = dadosOrigem.filter(itemOriginal => !idsTransferidos.has(itemOriginal.id));
    dadosOrigem.splice(0, dadosOrigem.length, ...origemRestante);
    salvarBancoDeDados(dadosOrigem);
    const salvoNaOrigem = await descarregarNuvem();
    if (!salvoNaOrigem) {
        window.dispatchEvent(new CustomEvent('Planora-dados-restaurados', { detail: { dados: dadosOrigem } }));
        window.dispatchEvent(new Event('Planora-workspace-atualizado'));
        const erro = new Error(`O item foi copiado para o destino, mas a remoção na origem não foi confirmada. Verifique os dois workspaces antes de repetir.`);
        erro.destinoGravado = true;
        throw erro;
    }
    window.dispatchEvent(new CustomEvent('Planora-dados-restaurados', { detail: { dados: dadosOrigem } }));
    window.dispatchEvent(new Event('Planora-workspace-atualizado'));
    return true;
}
window.Planora_Workspaces = {
    get lista() { return listaWorkspaces.slice(); },
    get atual() { return workspaceAtual; },
    selecionar: trocarWorkspace,
    telaInicial: () => trocarWorkspace(null),
    criarNovo: novoWorkspaceInterativo,
    renomear: renomearWorkspaceInterativo,
    transferirProjeto: transferirProjetoWorkspace,
    transferirItem: transferirProjetoWorkspace
};

/* Janela simples para dar nome a um novo workspace (usada pelo painel lateral). */
function pedirNomeWorkspace() {
    return new Promise(res => {
        const o = document.createElement('div');
        o.className = 'lg-overlay';
        o.innerHTML = `<div class="lg-card" role="dialog" aria-modal="true" aria-labelledby="ws-nome-tit">
            <div class="lg-logo">+</div><h2 id="ws-nome-tit">Novo workspace</h2>
            <p class="lg-sub">Dê um nome para o novo espaço. Ele começa vazio e não mexe nos seus outros workspaces.</p>
            <label>Nome<input id="ws-nome-in" type="text" maxlength="60" placeholder="Ex.: Projetos 2026" autocomplete="off"></label>
            <p class="lg-msg" role="alert"></p>
            <button class="lg-principal" id="ws-nome-ok" type="button">Criar e entrar</button>
            <div class="lg-links"><button id="ws-nome-cancelar" type="button">Cancelar</button></div></div>`;
        document.body.appendChild(o);
        const inp = o.querySelector('#ws-nome-in'), msg = o.querySelector('.lg-msg');
        const fechar = v => { document.removeEventListener('keydown', tecla); o.remove(); res(v); };
        const confirmar = () => {
            const n = nomeWsValido(inp.value);
            if (!n) { msg.textContent = 'Digite um nome para o workspace.'; return; }
            if (listaWorkspaces.some(w => w.nome.toLowerCase() === n.toLowerCase())) { msg.textContent = 'Você já tem um workspace com esse nome.'; return; }
            fechar(n);
        };
        const tecla = e => { if (e.key === 'Escape') fechar(null); };
        document.addEventListener('keydown', tecla);
        o.querySelector('#ws-nome-ok').onclick = confirmar;
        o.querySelector('#ws-nome-cancelar').onclick = () => fechar(null);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmar(); });
        inp.focus();
    });
}
function pedirNovoNomeWorkspace(ws) {
    return new Promise(res => {
        const o = document.createElement('div');
        o.className = 'lg-overlay';
        o.innerHTML = `<div class="lg-card" role="dialog" aria-modal="true" aria-labelledby="ws-renomear-tit">
            <div class="lg-logo">✎</div><h2 id="ws-renomear-tit">Renomear workspace</h2>
            <p class="lg-sub">O nome novo aparecerá no seletor e no painel lateral.</p>
            <label>Nome<input id="ws-renomear-in" type="text" maxlength="60" autocomplete="off"></label>
            <p class="lg-msg" role="alert"></p>
            <button class="lg-principal" id="ws-renomear-ok" type="button">Salvar nome</button>
            <div class="lg-links"><button id="ws-renomear-cancelar" type="button">Cancelar</button></div></div>`;
        document.body.appendChild(o);
        const inp = o.querySelector('#ws-renomear-in'), msg = o.querySelector('.lg-msg');
        inp.value = ws.nome;
        const fechar = v => { document.removeEventListener('keydown', tecla); o.remove(); res(v); };
        const confirmar = () => {
            const nome = nomeWsValido(inp.value);
            if (!nome) { msg.textContent = 'Digite um nome para o workspace.'; return; }
            fechar(nome);
        };
        const tecla = e => { if (e.key === 'Escape') fechar(null); };
        document.addEventListener('keydown', tecla);
        o.querySelector('#ws-renomear-ok').onclick = confirmar;
        o.querySelector('#ws-renomear-cancelar').onclick = () => fechar(null);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmar(); });
        inp.focus();
        inp.select();
    });
}

/* ---------- tela de boas-vindas: escolher um workspace existente ou criar outro ---------- */
function telaBoasVindas(lista) {
    return new Promise(res => {
        const o = document.createElement('div');
        o.className = 'lg-overlay ws-overlay';
        document.body.appendChild(o);
        const ultimoId = (() => { try { return localStorage.getItem(ULTIMO_WS + ':' + usuario.id); } catch (e) { return null; } })();
        const primeiroNome = escaparTag((usuario.email || '').split('@')[0] || 'por aqui');
        const matiz = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
        const vazio = !lista.length;
        const cartao = w => {
            const h = matiz(w.id), inicial = escaparTag((w.nome.trim()[0] || '?').toUpperCase());
            const meta = [w.created_at ? 'Criado em ' + dataCurta(w.created_at) : '', w.atualizado_em ? 'Atualizado em ' + dataCurta(w.atualizado_em) : ''].filter(Boolean).join(' · ');
            return `<button class="ws-card${w.id === ultimoId ? ' ws-card-ultimo' : ''}" type="button" data-id="${escaparTag(w.id)}" role="listitem">
                <span class="ws-avatar" style="--h:${h}" aria-hidden="true">${inicial}</span>
                <span class="ws-card-texto"><span class="ws-card-titulo"><span class="ws-card-nome">${escaparTag(w.nome)}</span>${w.id === ultimoId ? '<span class="ws-etiqueta ws-etiqueta-ultimo">Último acesso</span>' : ''}</span><span class="ws-card-meta">${escaparTag(meta)}</span></span>
            </button>`;
        };
        o.innerHTML = `<button class="btn-tema ws-theme-toggle" id="ws-tema" type="button" aria-label="Ativar modo claro" title="Ativar modo claro"></button>
            <main class="ws-conteudo">
                <header class="ws-hero">
                    <div class="ws-marca" aria-hidden="true">PNR</div>
                    <p class="ws-ola">${vazio ? 'Que bom ter você aqui' : 'Olá'}, <strong>${primeiroNome}</strong></p>
                    <h1>Bem-vindo ao <span>Planora</span></h1>
                    <p class="ws-sub">${vazio
                        ? 'Vamos começar criando seu primeiro workspace, um espaço só seu para organizar projetos, páginas e cards.'
                        : 'Entre em um dos seus workspaces para continuar de onde parou, ou crie um novo espaço separado para outro contexto.'}</p>
                </header>
                <section class="ws-secao ws-novo" aria-labelledby="ws-tit-novo"${vazio ? '' : ' hidden'}>
                    <div class="ws-secao-topo"><h2 id="ws-tit-novo">${vazio ? 'Criar meu primeiro workspace' : 'Novo workspace'}</h2></div>
                    <div class="ws-novo-linha">
                        <label class="ws-campo"><span class="ws-campo-rot">Nome do workspace</span>
                            <input id="ws-novo-nome" type="text" maxlength="60" autocomplete="off" placeholder="Ex.: Projetos 2026" value="${vazio ? 'Meu workspace' : ''}"></label>
                        <div class="ws-acoes-novo"><button class="ws-btn-criar" id="ws-novo-ok" type="button">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"></path></svg>
                            <span>Criar e entrar</span></button>${vazio ? '' : '<button class="ws-btn-cancelar" id="ws-novo-cancelar" type="button">Cancelar</button>'}</div>
                    </div>
                    <p class="ws-msg" role="alert" aria-live="polite"></p>
                </section>
                ${vazio ? '' : `<section class="ws-secao ws-secao-lista" aria-labelledby="ws-tit-lista">
                    <div class="ws-secao-topo"><div class="ws-secao-titulo"><h2 id="ws-tit-lista">Entrar em um workspace</h2><span class="ws-contagem">${lista.length}</span></div>
                        <button class="ws-btn-novo-workspace" id="ws-adicionar" type="button" aria-expanded="false">Novo workspace</button></div>
                    <div class="ws-lista" role="list">${lista.map(cartao).join('')}</div>
                </section>`}
                <footer class="ws-rodape"><span>${escaparTag(usuario.email || '')}</span><button type="button" id="ws-sair">Sair da conta</button></footer>
            </main>`;
        const q = s => o.querySelector(s), msg = t => { q('.ws-msg').textContent = t; };
        const btnTema = q('#ws-tema');
        const ICONE_SOL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
        const ICONE_LUA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';
        function atualizarBotaoTema() {
            if (!btnTema) return;
            const claro = document.documentElement.dataset.tema === 'claro';
            btnTema.innerHTML = claro ? ICONE_LUA : ICONE_SOL;
            btnTema.title = claro ? 'Ativar modo escuro' : 'Ativar modo claro';
            btnTema.setAttribute('aria-label', btnTema.title);
        }
        if (btnTema) {
            btnTema.addEventListener('click', () => {
                const novo = document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro';
                document.documentElement.dataset.tema = novo;
                try { localStorage.setItem('Planora_tema', novo); } catch (e) { /* sem armazenamento */ }
                const meta = document.querySelector('meta[name="theme-color"]');
                if (meta) meta.content = novo === 'claro' ? '#f1f5f9' : '#111827';
                atualizarBotaoTema();
            });
            atualizarBotaoTema();
        }
        const concluir = ws => { o.remove(); res(ws); };
        o.querySelectorAll('.ws-card[data-id]').forEach(b => b.onclick = () => concluir(lista.find(w => w.id === b.dataset.id)));
        const adicionar = q('#ws-adicionar');
        let formularioWsAberto = vazio;
        const abrirFecharWorkspace = (abrir, focar) => {
            const form = q('.ws-novo');
            formularioWsAberto = abrir;
            if (!adicionar || vazio) return;
            if (abrir) {
                form.hidden = false;
                form.classList.remove('fechando', 'entrando');
                void form.offsetWidth;
                form.classList.add('entrando');
                if (focar) setTimeout(() => q('#ws-novo-nome').focus(), 120);
            } else {
                form.classList.remove('entrando');
                form.classList.add('fechando');
                setTimeout(() => {
                    if (!formularioWsAberto) {
                        form.hidden = true;
                        form.classList.remove('fechando');
                    }
                }, 220);
            }
            adicionar.setAttribute('aria-expanded', String(abrir));
        };
        if (adicionar) adicionar.onclick = () => abrirFecharWorkspace(!formularioWsAberto, true);
        const cancelarNovo = q('#ws-novo-cancelar');
        if (cancelarNovo) cancelarNovo.onclick = () => {
            q('#ws-novo-nome').value = '';
            msg('');
            abrirFecharWorkspace(false, false);
        };
        q('#ws-sair').onclick = () => sairDaConta();
        const criar = async () => {
            const btn = q('#ws-novo-ok'), inp = q('#ws-novo-nome');
            const nome = nomeWsValido(inp.value);
            if (!nome) return msg('Digite um nome para o workspace.');
            btn.disabled = true; msg('');
            try {
                /* primeiro workspace de quem ainda tinha dados só neste navegador: leva esses dados junto */
                const locais = vazio ? dadosLocaisAntigos() : null;
                const ws = await criarWorkspace(nome, locais);
                ws.__importouLocal = !!locais;
                concluir(ws);
            } catch (e) {
                console.error(e);
                btn.disabled = false;
                msg(e && e.code === '42501' ? 'Sem permissão para criar workspaces. Verifique as políticas RLS no Supabase.' : (e.message || 'Não foi possível criar o workspace.'));
            }
        };
        q('#ws-novo-ok').onclick = criar;
        q('#ws-novo-nome').addEventListener('keydown', e => { if (e.key === 'Enter') criar(); });
        if (vazio) q('#ws-novo-nome').focus();
    });
}

/* ---------- inicialização: carrega da nuvem antes de a página montar ---------- */
async function iniciarBanco() {
    const paginaWorkspaces = ehTelaWorkspaces();
    const configurado = typeof SUPABASE_URL !== 'undefined' && !SUPABASE_URL.startsWith('COLE')
        && typeof SUPABASE_ANON_KEY !== 'undefined' && !SUPABASE_ANON_KEY.startsWith('COLE');
    if (!configurado || typeof supabase === 'undefined') {
        if (paginaWorkspaces) {
            location.replace(urlRetornoWorkspaces());
            return;
        }
        setStatus(!configurado
            ? 'Modo local: preencha js/config.js para ativar a nuvem'
            : 'Modo local: biblioteca do Supabase não carregou (sem internet?)');
        document.querySelectorAll('.btn-rodape').forEach(b => b.remove());
        inicializarHistorico();
        return;
    }
    const cliente = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb = cliente;
    let { data: { session } } = await sb.auth.getSession();
    if (!session) session = await telaLogin();
    usuario = session.user;
    const elEmail = document.getElementById('email-usuario');
    if (elEmail) elEmail.textContent = 'Conectado como ' + usuario.email;

    let alvo, importouLocal = false;
    try {
        listaWorkspaces = await carregarWorkspaces();
        const legado = await migrarLegadoSePreciso(listaWorkspaces);
        if (legado) listaWorkspaces = await carregarWorkspaces();
        if (paginaWorkspaces) {
            alvo = await telaBoasVindas(listaWorkspaces);
        } else {
            alvo = workspaceDaSessao(listaWorkspaces);
            if (!alvo) {
                window.Planora_REDIRECIONANDO_WORKSPACES = true;
                location.replace(urlTelaWorkspaces(location.pathname + location.search + location.hash));
                return;
            }
        }
        importouLocal = !!alvo.__importouLocal;
    } catch (e) {
        console.error(e);
        sb = null; usuario = null; // não envia nada, para não sobrescrever a nuvem
        inicializarHistorico();
        setStatus('Erro ao carregar da nuvem (somente leitura local)');
        alert('Não foi possível acessar seus workspaces:\n' + (e.message || e) +
            '\n\nSe for erro de permissão, confirme se as políticas RLS foram criadas (supabase/02_politicas_workspaces.sql).');
        return;
    }
    await ativarWorkspace(alvo, importouLocal);
    if (paginaWorkspaces) location.replace(urlRetornoWorkspaces());
}
const Planora_PRONTO = iniciarBanco().catch(e => { console.error(e); setStatus('Erro de conexão'); });

/* ---------- mídias: cache em IndexedDB + arquivo no Supabase Storage ---------- */
let _idb = null;
function abrirBancoMidia() {
    return _idb || (_idb = new Promise((ok, err) => {
        const r = indexedDB.open('Planora_midia_db', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('arquivos');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => err(r.error);
    }));
}
async function idbOp(modo, fn) {
    const b = await abrirBancoMidia();
    return new Promise((ok, err) => {
        const t = b.transaction(['arquivos'], modo);
        const rq = fn(t.objectStore('arquivos'));
        t.oncomplete = () => ok(rq && rq.result);
        t.onerror = () => err(t.error);
    });
}
async function enviarMidia(id, blob, tipo) {
    if (!sb || !usuario) return;
    const { error } = await sb.storage.from(BUCKET).upload(usuario.id + '/' + id, blob, { contentType: tipo, upsert: true });
    if (error) throw error;
}
const PENDENTES = 'Planora_midias_pendentes';
const lerPendentes = () => JSON.parse(localStorage.getItem(PENDENTES) || '[]');
async function salvarMidiaBlob(blob, tipo) {
    if (!blob) return null;
    const id = 'midia_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    tipo = tipo || blob.type || 'application/octet-stream';
    await idbOp('readwrite', s => s.put({ blob, tipo }, id));
    try {
        await enviarMidia(id, blob, tipo);
    } catch (e) {
        console.error('Falha ao enviar mídia:', e);
        localStorage.setItem(PENDENTES, JSON.stringify([...lerPendentes(), id]));
        alert('A mídia foi salva neste navegador, mas NÃO foi enviada para a nuvem:\n' + (e.message || e) +
            '\n\nEla será reenviada automaticamente na próxima vez que abrir o sistema. ' +
            'Se persistir, rode o trecho de Storage do setup.sql no Supabase.');
    }
    return id;
}
async function reenviarPendentes() {
    const restantes = [];
    for (const id of lerPendentes()) {
        const r = await idbOp('readonly', s => s.get(id));
        if (!r) continue;
        try { await enviarMidia(id, r.blob, r.tipo); } catch (e) { restantes.push(id); }
    }
    localStorage.setItem(PENDENTES, JSON.stringify(restantes));
}
async function obterMidiaBlob(id) {
    if (!id) return null;
    let r = await idbOp('readonly', s => s.get(id));
    if (r) return r;
    if (!sb || !usuario) return null;
    const { data, error } = await sb.storage.from(BUCKET).download(usuario.id + '/' + id);
    if (error || !data) return null;
    r = { blob: data, tipo: data.type };
    await idbOp('readwrite', s => s.put(r, id));
    return r;
}
async function deletarMidiaBlob(id) {
    if (!id) return;
    await idbOp('readwrite', s => s.delete(id));
    if (sb && usuario) await sb.storage.from(BUCKET).remove([usuario.id + '/' + id]);
}
async function sincronizarMidiasLocais() {
    for (const p of lerBancoDeDados())
        for (const c of (p.cards || []))
            if (c.midiaId) {
                const r = await idbOp('readonly', s => s.get(c.midiaId));
                if (r) try { await enviarMidia(c.midiaId, r.blob, r.tipo); } catch (e) { console.error(e); }
            }
}
/* ---------- Tags (bolhas coloridas) — usadas na tabela e no cabeçalho do projeto ---------- */
function escaparTag(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function corTextoTag(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return '#ffffff';
    const lum = 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255);
    return lum > 160 ? '#0f172a' : '#ffffff';       // texto escuro em cores claras
}
function htmlTagBolha(tag) {
    const cor = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(tag.cor) ? tag.cor : '#4b5563';
    return `<span class="tag-bolha" style="background:${cor};color:${corTextoTag(cor)}">${escaparTag(tag.nome)}</span>`;
}