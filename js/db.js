/* BAHUB — dados no Supabase, com cache local (localStorage + IndexedDB) */
const CHAVE_DB = 'bahub_db';
const BUCKET = 'midias';
const PEND_FLAG = 'bahub_pendente';
let seq = 0;
let sb = null, usuario = null, versao = null, timer = null, fila = Promise.resolve(), ultimoStatus = '';

function lerBancoDeDados() { return JSON.parse(localStorage.getItem(CHAVE_DB)) || []; }
function salvarBancoDeDados(dados) {
    localStorage.setItem(CHAVE_DB, JSON.stringify(dados));
    if (sb && usuario) { localStorage.setItem(PEND_FLAG, '1'); seq++; }
    agendarEnvio();
}
function setStatus(t) {
    ultimoStatus = t;
    const e = document.getElementById('status-nuvem');
    if (e) e.textContent = t;
}

/* ---------- envio com controle de conflito ---------- */
/* Envia já (use antes de trocar de página, para não perder o que acabou de salvar). */
function descarregarNuvem() {
    clearTimeout(timer);
    fila = fila.then(enviar);
    return fila;
}
function agendarEnvio() {
    if (!sb || !usuario) return;
    setStatus('Salvando...');
    clearTimeout(timer);
    timer = setTimeout(() => { fila = fila.then(enviar); }, 600);
}
async function enviar() {
    if (!sb || !usuario) return;
    const dados = lerBancoDeDados();
    const minhaSeq = seq;
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
        if (minhaSeq === seq) localStorage.removeItem(PEND_FLAG);
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
    localStorage.removeItem(PEND_FLAG);
    location.reload();
}

/* ---------- inicialização: carrega da nuvem antes de a página montar ---------- */
async function iniciarBanco() {
    const configurado = typeof SUPABASE_URL !== 'undefined' && !SUPABASE_URL.startsWith('COLE')
        && typeof SUPABASE_ANON_KEY !== 'undefined' && !SUPABASE_ANON_KEY.startsWith('COLE');
    if (!configurado || typeof supabase === 'undefined') {
        setStatus(!configurado
            ? 'Modo local: preencha js/config.js para ativar a nuvem'
            : 'Modo local: biblioteca do Supabase não carregou (sem internet?)');
        document.querySelectorAll('.btn-rodape').forEach(b => b.remove());
        return;
    }
    const cliente = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb = cliente;
    let { data: { session } } = await sb.auth.getSession();
    if (!session) session = await telaLogin();
    usuario = session.user;
    const elEmail = document.getElementById('email-usuario');
    if (elEmail) elEmail.textContent = 'Conectado como ' + usuario.email;
    const { data, error } = await sb.from('bahub_dados').select('dados,atualizado_em')
        .eq('user_id', usuario.id).maybeSingle();
    if (error) {
        console.error(error);
        sb = null; usuario = null; // não envia nada, para não sobrescrever a nuvem
        setStatus('Erro ao carregar da nuvem (somente leitura local)');
        return;
    }
    if (data) {
        versao = data.atualizado_em;
        if (localStorage.getItem(PEND_FLAG) === '1') {
            await enviar();   // havia alteração local ainda não enviada (ex.: trocou de página rápido)
        } else {
            localStorage.setItem(CHAVE_DB, JSON.stringify(data.dados));
        }
    } else if (lerBancoDeDados().length) {   // primeira vez: sobe o que já existe neste navegador
        await enviar();
        await sincronizarMidiasLocais();
    }
    setStatus('Salvo na nuvem');
    reenviarPendentes();
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
const PENDENTES = 'bahub_midias_pendentes';
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
