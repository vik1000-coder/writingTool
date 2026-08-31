/* All model and project text is rendered as text nodes, never HTML. */
(() => {
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
  const saved = vscode.getState() || {};
  let state = { mode: 'guide', artifacts: [], pins: [], excluded: [], history: [], status: 'Loading local project…' };
  let tab = saved.tab || 'Suggestion';
  let draft = saved.draft || '';
  const tabs = ['Suggestion', 'Evidence', 'Outline', 'Results', 'References', 'Figures', 'Context', 'Chat'];
  const descriptions = { off: 'No proactive AI. Ask an explicit question in Chat.', guide: 'An intention for your next sentence. Your words, your voice.', write: 'A short continuation. Tab to accept; Esc to dismiss.', evidence: 'Compare the current claim with local sources and data.', visual: 'Choose the right presentation for your actual results.', structure: 'See what the argument still needs.' };
  function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
  function button(text, fn, cls = 'link') { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', fn); return el; }
  function empty(title, text) { const el = node('div', undefined, 'empty'); el.append(node('h2', title), node('p', text, 'muted')); return el; }
  function warning(text) { return node('p', text, 'warning'); }
  function artifactsFor(kind) { return (state.catalog || state.artifacts || []).filter(a => kind.includes(a.kind)); }
  function source(a) {
    const card = node('article', undefined, 'card');
    card.append(node('span', a.kind.toUpperCase() + (state.pins?.includes(a.id) ? ' · PINNED' : ''), 'tag'), node('h3', a.title), node('div', a.path + (a.locator.page ? ` · p. ${a.locator.page}` : ''), 'muted source-path'));
    if (a.kind === 'pdf') card.append(node('blockquote', a.text), node('small', 'Exact locally extracted source text'));
    else if (a.kind === 'result') {
      if (a.metadata.dimensions) card.append(node('p', `${a.metadata.dimensions.rows} rows · ${a.metadata.dimensions.columns} columns`, 'muted'));
      const rows = a.metadata.rows || a.metadata.preview || [];
      if (rows.length) {
        const wrap = node('div', undefined, 'table-wrap'), table = node('table');
        const columns = a.locator.columns || Object.keys(rows[0]);
        const header = node('tr'); header.append(node('th', 'Row')); columns.forEach(c => header.append(node('th', c))); table.append(header);
        rows.slice(0, 12).forEach((row, i) => { const tr = node('tr'); tr.append(node('td', String(a.locator.rows?.[i] || i + 1))); columns.forEach(c => tr.append(node('td', String(row[c] ?? '—')))); table.append(tr); }); wrap.append(table); card.append(wrap);
      }
      if (a.metadata.statistics) { const d = node('details'); d.append(node('summary', 'Schema and descriptive statistics'), node('pre', JSON.stringify({ schema: a.metadata.schema, statistics: a.metadata.statistics }, null, 2))); card.append(d); }
      card.append(node('small', 'Rows count data records, excluding the header.'));
    } else if (a.kind === 'bib') {
      card.append(node('p', [a.metadata.author, a.metadata.year, a.metadata.journal || a.metadata.booktitle].filter(Boolean).join(' · '), 'muted'));
      if (!a.metadata.pdf_path) card.append(warning('Citation candidate — full-text evidence not verified.'));
    } else { const d = node('details'); d.append(node('summary', 'Inspect artifact'), node('pre', a.text)); card.append(d); }
    const actions = node('div', undefined, 'card-actions');
    actions.append(button(a.kind === 'pdf' ? 'Open highlighted passage' : 'Open source', () => send('open', { id: a.id })), button(state.pins?.includes(a.id) ? 'Unpin' : 'Pin context', () => send('pin', { id: a.id })));
    if (a.kind === 'bib') actions.append(button('Insert citation', () => send('cite', { id: a.id })));
    if (tab === 'Context') actions.append(button(state.excluded?.includes(a.id) ? 'Include' : 'Exclude', () => send('exclude', { id: a.id })));
    card.append(actions); return card;
  }
  function renderPanel() {
    const panel = $('panel'); panel.replaceChildren();
    const resolved = state.result, suggestion = resolved?.suggestion;
    if (tab === 'Suggestion') {
      if (!suggestion) panel.append(empty(state.mode === 'off' ? 'Space to think.' : 'Start with your own words.', state.mode === 'off' ? 'Switch modes when you want assistance, or ask in Chat.' : 'Place your cursor in the manuscript, choose a mode, and request a suggestion. Nothing is sent until you ask.'));
      else {
        const card = node('article', undefined, 'card primary'); card.append(node('span', suggestion.mode.toUpperCase(), 'tag'), node('h2', suggestion.title), node('p', suggestion.text || suggestion.insert_text, 'prose'));
        if (suggestion.insert_text) { card.append(node('pre', suggestion.insert_text), node('small', resolved.insertable ? 'Ghost text is available in the editor. Tab accepts it.' : 'Insertion blocked until evidence issues are resolved.')); }
        if (suggestion.proposal) { const p = suggestion.proposal; card.append(node('h3', p.type === 'none' ? 'No visualization needed' : `${p.type} proposal`), node('p', p.purpose), node('p', `Placement: ${p.placement}`, 'muted')); p.panels.forEach(text => card.append(node('p', text))); }
        if (suggestion.edit) card.append(button('Review proposed diff', () => send('reviewEdit'), 'secondary'));
        panel.append(card);
        resolved.warnings.forEach(w => panel.append(warning(w)));
        if (resolved.evidence.length) panel.append(button(`Inspect ${resolved.evidence.length} evidence sources →`, () => selectTab('Evidence')));
      }
    } else if (tab === 'Evidence') {
      const evidence = resolved?.evidence || [];
      panel.append(node('p', 'Source passages and data are resolved locally, never quoted by the model.', 'muted'));
      if (!evidence.length) panel.append(empty('No evidence selected yet.', 'Use EVIDENCE mode on a manuscript claim, or search References and Results.'));
      evidence.forEach(a => panel.append(source(a)));
      resolved?.warnings.forEach(w => panel.append(warning(w)));
    } else if (tab === 'Context') {
      panel.append(node('h2', 'You choose the context.'), node('p', 'Pins take priority. Exclusions are never sent. Your current manuscript buffer overrides saved text.', 'muted'));
      panel.append(button('Inspect exact request & response', () => send('inspect')), button('Confirm evidence relationship', () => send('relation')), button('Set section goal', () => send('sectionMemory')));
      if (state.context) {
        panel.append(node('p', `${JSON.stringify(state.context).length.toLocaleString()} context characters · ${state.context.artifacts.length} artifacts`, 'muted'));
        state.context.warnings.forEach(w => panel.append(warning(w)));
        state.context.artifacts.forEach(a => panel.append(source(a)));
      } else panel.append(empty('No model request yet.', 'You can pin local artifacts from the other panels before making a request.'));
      if (state.excluded?.length) { panel.append(node('h3', 'Excluded from context')); state.excluded.forEach(id => panel.append(button(`Include ${id}`, () => send('exclude', { id })))); }
    } else if (tab === 'Chat') {
      panel.append(node('p', 'Explicit questions work in every mode, including OFF. Edits require a reviewed diff and your approval.', 'muted'));
      state.history?.forEach(m => { const el = node('div', undefined, 'chat-message'); el.append(node('span', m.role === 'user' ? 'YOU' : 'RESEARCH COPILOT', 'tag'), node('p', m.text, 'prose')); panel.append(el); });
      const form = node('form'), input = node('textarea'); input.placeholder = 'Ask about the paper or request a specific edit…'; input.setAttribute('aria-label', 'Question for Research Copilot'); input.value = draft;
      input.addEventListener('input', () => { draft = input.value; vscode.setState({ tab, draft }); });
      const submit = node('button', 'Ask'); submit.type = 'submit'; submit.disabled = state.busy;
      form.append(input, submit); form.addEventListener('submit', e => { e.preventDefault(); if (input.value.trim()) { send('chat', { question: input.value.trim() }); draft = ''; input.value = ''; vscode.setState({ tab, draft }); } }); panel.append(form);
      if (suggestion?.edit) panel.append(button('Review proposed diff', () => send('reviewEdit'), 'secondary'));
    } else {
      const map = { Outline: ['outline'], Results: ['result'], References: ['bib', 'pdf'], Figures: ['figure', 'table'] };
      const input = node('input', undefined, 'search'); input.placeholder = `Search ${tab.toLowerCase()}…`; input.setAttribute('aria-label', input.placeholder); input.value = saved.search || '';
      let timer; input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => send('search', { query: input.value, kinds: map[tab] }), 250); }); panel.append(input);
      if (tab === 'Outline' && state.ephemeralOutline) panel.append(node('p', 'From manuscript headings · no outline file was created.', 'muted'));
      const values = artifactsFor(map[tab]);
      if (!values.length) panel.append(empty(`No ${tab.toLowerCase()} found.`, 'Add project files or adjust .research-copilot/project.yaml, then refresh.'));
      values.forEach(a => panel.append(source(a)));
      if (state.catalogTruncated) panel.append(node('p', 'Showing the first 100 matches. Search to narrow results.', 'muted'));
    }
    if (state.indexWarnings?.length) { const d = node('details'); d.append(node('summary', `${state.indexWarnings.length} indexing notice(s)`)); state.indexWarnings.forEach(w => d.append(warning(w))); panel.append(d); }
  }
  function selectTab(value) { tab = value; vscode.setState({ tab, draft }); document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', String(b.textContent === tab))); renderPanel(); if (!['Suggestion', 'Evidence', 'Context', 'Chat'].includes(tab)) send('catalog', { tab }); }
  for (const value of tabs) { const b = button(value, () => selectTab(value)); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(value === tab)); document.querySelector('nav').append(b); }
  $('mode').addEventListener('change', e => send('mode', { mode: e.target.value }));
  $('suggest').addEventListener('click', () => send('suggest')); $('cancel').addEventListener('click', () => send('cancel')); $('setup').addEventListener('click', () => send('setup')); $('refresh').addEventListener('click', () => send('refresh'));
  window.addEventListener('message', e => {
    if (e.data.type !== 'state') return;
    state = { ...state, ...e.data.state };
    $('mode').value = state.mode; $('mode-help').textContent = descriptions[state.mode]; $('status').textContent = state.status || '';
    $('suggest').disabled = state.busy || state.mode === 'off'; $('suggest').textContent = state.busy ? 'Thinking…' : state.mode === 'write' ? 'Continue in editor' : 'Suggest next step'; $('cancel').hidden = !state.busy;
    $('project-label').textContent = `${state.project || 'Local project'} · ${state.artifactCount || 0} artifacts · Read-only suggestions`;
    const focused = document.activeElement; const restoreChat = focused?.tagName === 'TEXTAREA';
    const restoreSearch = focused?.classList.contains('search'); const searchValue = restoreSearch ? focused.value : ''; const start = focused?.selectionStart;
    renderPanel();
    const restore = restoreChat ? document.querySelector('textarea') : restoreSearch ? document.querySelector('.search') : null;
    if (restore) { if (restoreSearch) restore.value = searchValue; restore.focus(); restore.setSelectionRange(start, start); }
  });
  renderPanel(); send('ready');
})();
