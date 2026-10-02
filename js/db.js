/* BAHUB — dados no Supabase, com cache local (localStorage + IndexedDB) */
const CHAVE_DB = 'bahub_db';
const BUCKET = 'midias';
let sb = null, usuario = null, versao = null, timer = null, fila = Promise.resolve(), ultimoStatus = '';

function lerBancoDeDados() { return JSON.parse(localStorage.getItem(CHAVE_DB)) || []; }
function salvarBancoDeDados(dados) {
    localStorage.setItem(CHAVE_DB, JSON.stringify(dados));
    agendarEnvio();
}
function setStatus(t) {
    ultimoStatus = t;
    const e = document.getElementById('status-nuvem');
    if (e) e.textContent = t;
}

/* ---------- envio com controle de conflito ---------- */
function agendarEnvio() {
    if (!sb || !usuario) return;
    setStatus('Salvando...');
    clearTimeout(timer);
    timer = setTimeout(() => { fila = fila.then(enviar); }, 600);
}
async function enviar() {
    if (!sb || !usuario) return;
    const dados = lerBancoDeDados();
    try {
        let r;
        if (versao === null) {
            r = await sb.from('bahub_dados').upsert({ user_id: usuario.id, dados }, { onConflict: 'user_id' })
                .select('atualizado_em').single();
            if (r.error) throw r.error;
            versao = r.data.atualizado_em;
        } else {
            r = await sb.from('bahub_dados').update({ dados })
                .eq('user_id', usuario.id).eq('atualizado_em', versao).select('atualizado_em');
            if (r.error) throw r.error;
            if (!r.data.length) {
                setStatus('Conflito: recarregue a página');
                alert('Outro computador alterou os dados. Recarregue a página para ver a versão mais recente.\n\nSuas últimas alterações NÃO foram enviadas.');
                return;
            }
            versao = r.data[0].atualizado_em;
        }
        setStatus('Salvo na nuvem');
    } catch (e) {
        console.error(e);
        setStatus('Erro ao salvar na nuvem');
    }
}

/* ---------- login ---------- */
function telaLogin() {
    return new Promise(res => {
        const o = document.createElement('div');
        o.className = 'modal-overlay';
        o.style.display = 'flex';
        o.innerHTML = `<div class="modal-card"><div class="modal-header"><h2>Entrar no BAHUB</h2></div>
            <input id="lg-email" class="input-texto" type="email" placeholder="E-mail" autocomplete="username">
            <input id="lg-senha" class="input-texto" type="password" placeholder="Senha (mínimo 6 caracteres)" autocomplete="current-password">
            <p id="lg-msg" style="color:#dc2626;font-size:13px;min-height:18px;margin:0 0 12px"></p>
            <button class="btn-salvar" id="lg-entrar" type="button">Entrar</button>
            <button class="aba" id="lg-criar" type="button" style="margin-left:8px;color:#475569;border-color:#cbd5e1">Criar conta</button></div>`;
        document.body.appendChild(o);
        const q = s => o.querySelector(s), msg = t => q('#lg-msg').textContent = t;
        const cred = () => ({ email: q('#lg-email').value.trim(), password: q('#lg-senha').value });
        q('#lg-entrar').onclick = async () => {
            const { data, error } = await sb.auth.signInWithPassword(cred());
            if (error) return msg('E-mail ou senha incorretos.');
            o.remove(); res(data.session);
        };
        q('#lg-criar').onclick = async () => {
            const { data, error } = await sb.auth.signUp(cred());
            if (error) return msg(error.message);
            if (data.session) { o.remove(); res(data.session); }
            else msg('Conta criada. Confirme o e-mail e clique em Entrar.');
        };
        q('#lg-senha').addEventListener('keydown', e => { if (e.key === 'Enter') q('#lg-entrar').click(); });
    });
}
async function sairDaConta() {
    if (!sb || !usuario) {
        alert('A nuvem não está ativa, então não há conta para sair. Seus dados continuam salvos neste navegador.');
        return;
    }
    /* Só sai (e limpa o cache local) depois de confirmar que tudo foi para a nuvem. */
    clearTimeout(timer);
    await fila;
    await enviar();
    if (ultimoStatus !== 'Salvo na nuvem') {
        alert('Não foi possível confirmar o envio dos dados para a nuvem. Você NÃO foi desconectado, para não perder nada.');
        return;
    }
    await sb.auth.signOut();
    localStorage.removeItem(CHAVE_DB);
    location.reload();
}

/* ---------- inicialização: carrega da nuvem antes de a página montar ---------- */
async function iniciarBanco() {
    if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.startsWith('COLE')) {
        setStatus('Modo local (nuvem não configurada)');
        document.querySelectorAll('.btn-rodape').forEach(b => b.remove());
        return;
    }
    const cliente = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb = cliente;
    let { data: { session } } = await sb.auth.getSession();
    if (!session) session = await telaLogin();
    usuario = session.user;
    const { data, error } = await sb.from('bahub_dados').select('dados,atualizado_em')
        .eq('user_id', usuario.id).maybeSingle();
    if (error) {
        console.error(error);
        sb = null; usuario = null; // não envia nada, para não sobrescrever a nuvem
        setStatus('Erro ao carregar da nuvem (somente leitura local)');
        return;
    }
    if (data) {
        localStorage.setItem(CHAVE_DB, JSON.stringify(data.dados));
        versao = data.atualizado_em;
    } else if (lerBancoDeDados().length) {   // primeira vez: sobe o que já existe neste navegador
        await enviar();
        await sincronizarMidiasLocais();
    }
    setStatus('Salvo na nuvem');
}
const BAHUB_PRONTO = iniciarBanco().catch(e => { console.error(e); setStatus('Erro de conexão'); });

/* ---------- mídias: cache em IndexedDB + arquivo no Supabase Storage ---------- */
let _idb = null;
function abrirBancoMidia() {
    return _idb || (_idb = new Promise((ok, err) => {
        const r = indexedDB.open('bahub_midia_db', 1);
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
async function salvarMidiaBlob(blob, tipo) {
    if (!blob) return null;
    const id = 'midia_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
    tipo = tipo || blob.type || 'application/octet-stream';
    await idbOp('readwrite', s => s.put({ blob, tipo }, id));
    await enviarMidia(id, blob, tipo);
    return id;
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