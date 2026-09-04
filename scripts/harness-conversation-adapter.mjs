// Product-only additions to the pinned rc.7 ui-conversation owner. Never edit
// the Harness checkout: both runtime assemblers apply this to their copied lib.
export const CONVERSATION_ADAPTER_PATH = 'scripts/harness-conversation-adapter.mjs'
export const CONVERSATION_PACKAGE = '@deepseek-ai/dsh-client-ui-conversation'

function replaceOnce(source, before, after, owner) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`Harness conversation adapter ${owner}: expected one rc.7 seam, found ${count}`)
  return source.replace(before, after)
}

// This function is embedded unchanged into the native client closure. It is the
// persistence/public-facade boundary; imported-file RPC validation stays upstream.
function emateDraftFiles(value) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('附件草稿无效。')
  const seen = new Set()
  return value.map(file => {
    if (file === null || typeof file !== 'object'
      || typeof file.stored_name !== 'string' || file.stored_name.length === 0
      || file.stored_name.startsWith('.') || /[\s@<>:"/\\|?*\u0000-\u001f]/u.test(file.stored_name)
      || /[. ]$/u.test(file.stored_name)
      || file.relative_path !== '.e-mate/imports/' + file.stored_name
      || typeof file.display_name !== 'string' || file.display_name.length === 0
      || /[<>:"/\\|?*\u0000-\u001f]/u.test(file.display_name)
      || typeof file.media_type !== 'string' || file.media_type.length === 0
      || seen.has(file.relative_path)) throw new Error('附件草稿无效。')
    seen.add(file.relative_path)
    return Object.freeze({
      stored_name: file.stored_name, relative_path: file.relative_path,
      display_name: file.display_name, media_type: file.media_type,
    })
  })
}

// Pending steering and the native queue editor share this display/model split.
function emateImportedText(text) {
  const paths = []
  const clean = text.replace(/(^|\s)@(\.e-mate\/imports\/\S+)/gu, (token, space, path) => {
    const name = path.slice('.e-mate/imports/'.length)
    if (name.startsWith('.') || /[\s@<>:"/\\|?*\u0000-\u001f]/u.test(name)) return token
    if (!paths.includes(path)) paths.push(path)
    return space
  })
  return { text: paths.length ? clean.trimEnd() : text, filePaths: paths }
}
function emateFileDisplay(text) {
  const value = emateImportedText(text)
  return [value.text, ...value.filePaths.map(path => path.slice('.e-mate/imports/'.length))].filter(Boolean).join('\n')
}
function emateQueuePreview(row) {
  const text = row.content.map(block => block.type === 'text' ? emateFileDisplay(block.text) : `[${block.type}]`).join(' ').replace(/\s+/gu, ' ').trim()
  const chars = Array.from(text)
  return chars.length > 200 ? chars.slice(0, 200).join('') + '…' : text
}

/** Apply exact compiled seams from packages/client/ui-conversation/src/client. */
export function adaptHarnessConversationSource(source) {
  const change = (before, after, owner) => { source = replaceOnce(source, before, after, owner) }

  // stores.ts: extend the existing per-session dsh.conversation.chat record.
  change('\t\tfunction createChatStore() {', `${[emateDraftFiles, emateImportedText, emateFileDisplay, emateQueuePreview].map(fn => fn.toString()).join('\n')}\n\t\tfunction createChatStore() {`, 'stores/helper')
  change('\t\t\t\t\tdraft: "",\n\t\t\t\t\tview: null,', '\t\t\t\t\tdraft: "",\n\t\t\t\t\tfileRefs: [],\n\t\t\t\t\tview: null,', 'stores/init')
  change('\t\t\t\t\tsetDraft: (d, text) => {\n\t\t\t\t\t\td.draft = text;\n\t\t\t\t\t},', '\t\t\t\t\tsetDraft: (d, text, fileRefs = []) => {\n\t\t\t\t\t\td.draft = text;\n\t\t\t\t\t\td.fileRefs = fileRefs;\n\t\t\t\t\t},', 'stores/mirror-action')

  // input/facade.ts: files live beside imageIds, not in another plugin store.
  change('\t\t\timageIds = [];\n\t\t\tdisposed = false;', '\t\t\timageIds = [];\n\t\t\tfileRefs = [];\n\t\t\tlastFileRefs = this.fileRefs;\n\t\t\tdisposed = false;', 'facade/state')
  change('\t\t\t\taddImages: (ids) => this.addImages(ids),', '\t\t\t\taddFiles: (files, draft) => this.addFiles(files, draft),\n\t\t\t\tremoveFile: (path) => this.removeFile(path),\n\t\t\t\trestoreDraft: (text, files) => this.restoreDraft(text, files),\n\t\t\t\taddImages: (ids) => this.addImages(ids),', 'facade/actions')
  change('\t\t\t/** Append ordered image ids unless an admission transaction is locked. */', `
\t\t\taddFiles(files, draft) {
\t\t\t\tif (this.disposed || this.snapshot.phase === "adjudicating" || this.snapshot.phase === "submitting") return false;
\t\t\t\tconst current = new Set(this.fileRefs.map(file => file.relative_path));
\t\t\t\tconst added = emateDraftFiles(files).filter(file => !current.has(file.relative_path));
\t\t\t\tif (this.fileRefs.length + added.length > 64) throw new Error("草稿最多可添加 64 个文件。");
\t\t\t\tthis.fileRefs = [...this.fileRefs, ...added];
\t\t\t\tif (draft !== undefined) this.setDraft(draft);
\t\t\t\telse this.publish();
\t\t\t\treturn true;
\t\t\t}
\t\t\tremoveFile(path) {
\t\t\t\tthis.fileRefs = this.fileRefs.filter(file => file.relative_path !== path);
\t\t\t\tthis.publish();
\t\t\t}
\t\t\trestoreFiles(files) {
\t\t\t\tconst current = new Set(this.fileRefs.map(file => file.relative_path));
\t\t\t\tthis.fileRefs = [...files.filter(file => !current.has(file.relative_path)), ...this.fileRefs];
\t\t\t\tthis.publish();
\t\t\t}
\t\t\trestoreDraft(text, files = []) {
\t\t\t\ttry { this.fileRefs = emateDraftFiles(files); }
\t\t\t\tcatch { this.setDraft(text); this.notify("error", "附件草稿无法恢复，请重新选择文件。"); return; }
\t\t\t\tthis.setDraft(text);
\t\t\t}
\t\t\t/** Append ordered image ids unless an admission transaction is locked. */`, 'facade/file-lifecycle')
  change('\t\t\tcommitSend(imageIds) {\n\t\t\t\tconst submitted = new Set(imageIds);', '\t\t\tcommitSend(imageIds, files = []) {\n\t\t\t\tconst submittedFiles = new Set(files.map(file => file.relative_path));\n\t\t\t\tthis.fileRefs = this.fileRefs.filter(file => !submittedFiles.has(file.relative_path));\n\t\t\t\tconst submitted = new Set(imageIds);', 'facade/commit')
  change('if (this.snapshot.draft.trim() === "" && this.imageIds.length > 0)', 'if (this.snapshot.draft.trim() === "" && (this.imageIds.length > 0 || this.fileRefs.length > 0))', 'facade/file-only-submit')
  change('\t\t\t\t\timageIds: this.imageIds,', '\t\t\t\t\timageIds: this.imageIds,\n\t\t\t\t\tfileRefs: this.fileRefs,', 'facade/snapshot')
  change('if (next.draft !== this.lastDraft) {\n\t\t\t\t\tthis.lastDraft = next.draft;\n\t\t\t\t\tthis.mirrorFn?.(next.draft);', 'if (next.draft !== this.lastDraft || next.fileRefs !== this.lastFileRefs) {\n\t\t\t\t\tthis.lastDraft = next.draft;\n\t\t\t\t\tthis.lastFileRefs = next.fileRefs;\n\t\t\t\t\tthis.mirrorFn?.(next.draft, next.fileRefs);', 'facade/persistence')

  // input/hub.ts: retain the native prompt/queue/steer transport and rollback.
  change(`\t\t\t\tif (text === "" && imageIds.length === 0) return;
\t\t\t\tconst shell = this.shells.get(session.sessionId);
\t\t\t\tshell?.commitSend(imageIds);`, `\t\t\t\tconst shell = this.shells.get(session.sessionId);
\t\t\t\tconst files = shell?.snapshot.fileRefs ?? [];
\t\t\t\tif (text === "" && imageIds.length === 0 && files.length === 0) return;
\t\t\t\tconst draftText = text;
\t\t\t\tif (files.length > 0) {
\t\t\t\t\ttext = [text, ...files.map(file => "@" + file.relative_path)].filter(Boolean).join("\\n");
\t\t\t\t\tmentions = [...(mentions ?? []), ...files.map(file => ({ source: "e-mate/file-import", ref: JSON.stringify(file) }))];
\t\t\t\t}
\t\t\t\tshell?.commitSend(imageIds, files);`, 'hub/admission')
  change('\t\t\t\t\t\tshell?.restoreImages(imageIds);\n\t\t\t\t\t\tif (shell?.snapshot.draft === "") shell.setDraft(text);', '\t\t\t\t\t\tshell?.restoreFiles(files);\n\t\t\t\t\t\tshell?.restoreImages(imageIds);\n\t\t\t\t\t\tif (shell?.snapshot.draft === "") shell.setDraft(draftText);', 'hub/rollback')

  // skeleton/ConversationSession.tsx: hydrate the same scoped native store.
  change('const storedDraft = useStore((s) => s.draft);', 'const storedDraft = useStore((s) => s.draft);\n\t\t\tconst storedFiles = useStore((s) => s.fileRefs);', 'session/persisted-files')
  change('if (inputState.draft === "" && storedDraft !== "") inputActions.setDraft(storedDraft);', 'if (inputState.draft === "" && inputState.fileRefs.length === 0) inputActions.restoreDraft(storedDraft, storedFiles ?? []);', 'session/hydrate')

  // skeleton/InputBar.tsx: toolbar/Enter retain native locks and submit policy.
  change('const empty = draft.trim() === "" && attachments.length === 0;', 'const empty = draft.trim() === "" && attachments.length === 0 && (input?.fileRefs.length ?? 0) === 0;', 'input-bar/empty')
  // apply.ts: the native entry keeps ownership of plan/model and its assembled
  // renderSlot binding. Product content decorates that body through one child.
  change('\t\t\t\tname: "conversation.composer.bar",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {', '\t\t\t\tname: "conversation.composer.bar",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {\n\t\t\t\t\t"e-mate.conversation.composer": { kind: "single", scope: "session-maybe" },', 'apply/composer-declaration')
  change('\t\t\t}, InputBar);', `\t\t\t}, function EmateComposer(props) {
\t\t\t\treturn props.renderSlot("e-mate.conversation.composer", { nativeProps: props, InputBar }, { fallback: (0, react_jsx_runtime.jsx)(InputBar, props) });
\t\t\t});`, 'apply/composer-body')
  // chat/MessageItem.tsx: native pending steering has no keyed renderer. Keep
  // its native actions and show the managed filename until the durable node
  // supplies the richer file-import card projection.
  change('\t\tfunction projectUserText(text) {', '\t\tfunction projectUserText(text) {\n\t\t\ttext = emateFileDisplay(text);', 'message/pending-steering-display')
  // queue/QueueDock.tsx: edit the prose while retaining the exact file paths in
  // the existing edit transaction. Preview text must never become model text.
  change('children: row.preview', 'children: emateQueuePreview(row)', 'queue/preview')
  change('text: row.text\n', '...emateImportedText(row.text)\n', 'queue/begin-edit')
  change('id: row.id,\n\t\t\t\t\t\t\t\t\t\t\ttext: event.currentTarget.value', '...editing,\n\t\t\t\t\t\t\t\t\t\t\ttext: event.currentTarget.value', 'queue/edit-text')
  change('if (editing === null || editing.text.trim() === "") return;', 'if (editing === null || (editing.text.trim() === "" && editing.filePaths.length === 0)) return;', 'queue/save-admission')
  change('text: editing.text\n', 'text: [editing.text, ...editing.filePaths.map(path => "@" + path)].filter(Boolean).join("\\n")\n', 'queue/save-model-text')
  change('disabled: busy !== null || editing.text.trim() === "",', 'disabled: busy !== null || (editing.text.trim() === "" && editing.filePaths.length === 0),', 'queue/save-button')
  return source
}
