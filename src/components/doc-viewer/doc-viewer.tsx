// src/components/doc-viewer/doc-viewer.tsx
import { Component, h, Prop, State } from '@stencil/core';
import { NormalizedRect } from '../../types/annotations';
import { PageComment, AnnotationKind } from '../../types/comments';
import { HistoryManager } from '../../utils/history';

const pdfjsLib = (window as any).pdfjsLib;
const TAG_OPTIONS = ['None', 'Important', 'Todo', 'Question', 'Idea'];

export type FileType = 'pdf' | 'image' | 'text';

@Component({
  tag: 'doc-viewer',
  styleUrl: 'doc-viewer.css',
  shadow: false,
})
export class DocViewer {
  @Prop() src!: string;
  @Prop() scale: number = 1.2;
  @Prop() fileType: FileType = 'pdf';

  // Embedded (LMS) → no toolbar, read-only
  @Prop({ mutable: true, reflect: true }) embedded: boolean = false;

  // Theme + mode (editor / viewer)
  @Prop({ mutable: true, reflect: true }) theme: 'light' | 'dark' | 'sepia' = 'light';
  @Prop({ mutable: true, reflect: true }) mode: 'viewer' | 'editor' = 'editor';

  @State() numPages = 0;
  @State() activeTool: 'select' | 'highlight' | 'comment' | 'note' = 'select';

  @State() annotations: Record<number, NormalizedRect[]> = {};
  @State() comments: Record<number, PageComment[]> = {};

  @State() sidebarOpen = false;
  @State() sidebarPage: number | null = null;
  @State() sidebarSelectedId: string | null = null;
  @State() sidebarDraftText = '';
  @State() sidebarDraftTag = 'None';

  private history = new HistoryManager<{
    annotations: Record<number, NormalizedRect[]>;
    comments: Record<number, PageComment[]>;
  }>();

  private fileInputEl?: HTMLInputElement;

  // ---------- STORAGE ----------
  private storageKey(kind: 'annotations' | 'comments'): string {
    const base = this.src || 'default';
    const safe = base.replace(/[^a-z0-9]/gi, '_');
    return `dv_${kind}_${safe}`;
  }

  private detectFileType(src: string): FileType {
    const s = src.toLowerCase();
    if (s.endsWith('.pdf')) return 'pdf';
    if (s.match(/\.(png|jpe?g|gif|bmp|webp)$/)) return 'image';
    if (s.match(/\.(txt|md)$/)) return 'text';
    return 'text';
  }

  async componentDidLoad() {
    // Optional: auto-embedded from URL ?embedded=true
    const url = new URL(window.location.href);
    if (url.searchParams.get('embedded') === 'true') {
      this.embedded = true;
    }

    const ann = localStorage.getItem(this.storageKey('annotations'));
    if (ann) this.annotations = JSON.parse(ann);

    const cm = localStorage.getItem(this.storageKey('comments'));
    if (cm) this.comments = JSON.parse(cm);

    if (!this.fileType) this.fileType = this.detectFileType(this.src);

    if (this.fileType === 'pdf') {
      const loadingTask = pdfjsLib.getDocument(this.src);
      const pdf = await loadingTask.promise;
      this.numPages = pdf.numPages;
    } else {
      this.numPages = 1;
    }

    this.history.pushState({
      annotations: this.annotations,
      comments: this.comments,
    });
  }

  // ===== HISTORY =====
  private pushHistory() {
    this.history.pushState({
      annotations: this.annotations,
      comments: this.comments,
    });
  }

  private persist() {
    localStorage.setItem(this.storageKey('annotations'), JSON.stringify(this.annotations));
    localStorage.setItem(this.storageKey('comments'), JSON.stringify(this.comments));
  }

  undo = () => {
    const state = this.history.undo({
      annotations: this.annotations,
      comments: this.comments,
    });
    if (!state) return;
    this.annotations = state.annotations;
    this.comments = state.comments;
    this.persist();
  };

  redo = () => {
    const state = this.history.redo({
      annotations: this.annotations,
      comments: this.comments,
    });
    if (!state) return;
    this.annotations = state.annotations;
    this.comments = state.comments;
    this.persist();
  };

  // ===== ANNOTATION EVENTS =====
  handleAnnotationCreated = (ev: CustomEvent<{ page: number; rect: NormalizedRect }>) => {
    const { page, rect } = ev.detail;
    this.pushHistory();

    const updated = { ...this.annotations };
    const list = updated[page] ? [...updated[page]] : [];
    list.push(rect);
    updated[page] = list;

    this.annotations = updated;
    this.persist();
  };

  handleCommentAddRequested = (
    ev: CustomEvent<{ page: number; x: number; y: number; kind: AnnotationKind }>
  ) => {
    this.pushHistory();

    const { page, x, y, kind } = ev.detail;
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);

    const updated = { ...this.comments };
    const list = updated[page] ? [...updated[page]] : [];

    list.push({
      id,
      kind,
      x,
      y,
      text: '',
      tag: 'None',
      createdAt: new Date().toISOString(),
    });

    updated[page] = list;
    this.comments = updated;
    this.persist();

    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = id;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  handleCommentIconClicked = (ev: CustomEvent<{ page: number; commentId: string }>) => {
    const { page, commentId } = ev.detail;

    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = commentId;

    const c = this.getComment(page, commentId);
    if (c) {
      this.sidebarDraftText = c.text;
      this.sidebarDraftTag = c.tag;
    }
  };

  private getComment(page: number, id: string) {
    const list = this.comments[page] || [];
    return list.find((c) => c.id === id) || null;
  }

  // ===== TOOLBAR =====
  setTool(tool: 'select' | 'highlight' | 'comment' | 'note') {
    this.activeTool = tool;
  }

  changeTheme(newTheme: 'light' | 'dark' | 'sepia') {
    this.theme = newTheme;
  }

  changeMode(newMode: 'viewer' | 'editor') {
    this.mode = newMode;
  }

  // ===== SIDEBAR =====
  private getSidebarComments() {
    if (!this.sidebarPage) return [];
    return this.comments[this.sidebarPage] || [];
  }

  private getSelectedComment() {
    if (!this.sidebarPage || !this.sidebarSelectedId) return null;
    const list = this.comments[this.sidebarPage] || [];
    return list.find((c) => c.id === this.sidebarSelectedId) || null;
  }

  private selectSidebarComment(id: string) {
    this.sidebarSelectedId = id;
    const c = this.getSelectedComment();
    if (c) {
      this.sidebarDraftText = c.text;
      this.sidebarDraftTag = c.tag;
    }
  }

  saveSidebarAnnotation = () => {
    if (!this.sidebarPage || !this.sidebarSelectedId) return;

    this.pushHistory();

    const page = this.sidebarPage;
    const list = [...(this.comments[page] || [])];
    const idx = list.findIndex((c) => c.id === this.sidebarSelectedId);
    if (idx < 0) return;

    list[idx] = {
      ...list[idx],
      text: this.sidebarDraftText,
      tag: this.sidebarDraftTag,
    };

    this.comments = { ...this.comments, [page]: list };
    this.persist();
  };

  // ===== MOCK AI TAG =====
  private async mockAITag(text: string): Promise<string> {
    text = text.toLowerCase();
    if (!text.trim()) return 'None';
    if (text.includes('?')) return 'Question';
    if (text.includes('important') || text.length > 80) return 'Important';
    if (text.includes('todo') || text.includes('fix')) return 'Todo';
    if (text.includes('idea')) return 'Idea';
    return 'Idea';
  }

  closeSidebar = () => {
    this.sidebarOpen = false;
    this.sidebarPage = null;
    this.sidebarSelectedId = null;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // ===== DELETE COMMENT =====
  deleteSidebarAnnotation = () => {
    if (!this.sidebarPage || !this.sidebarSelectedId) return;

    this.pushHistory();

    const page = this.sidebarPage;
    const list = [...(this.comments[page] || [])];

    const updated = list.filter((c) => c.id !== this.sidebarSelectedId);
    this.comments = { ...this.comments, [page]: updated };
    this.persist();

    this.sidebarSelectedId = null;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // ===== EXPORT / IMPORT =====
  exportJson = () => {
    const data = { annotations: this.annotations, comments: this.comments };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  onImportFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        this.pushHistory();
        this.annotations = data.annotations || {};
        this.comments = data.comments || {};
        this.persist();
      } catch {
        // ignore
      }
    };
    reader.readAsText(file);
  };

  // ===== SIDEBAR UI =====
  renderSidebar() {
    if (!this.sidebarOpen || !this.sidebarPage) return null;

    const pageComments = this.getSidebarComments();
    const selected = this.getSelectedComment();
    const readOnly = this.mode === 'viewer' || this.embedded;

    return (
      <div class="comment-sidebar">
        <div class="sidebar-header">
          <strong>Annotations – Page {this.sidebarPage}</strong>
          <button class="close-btn" onClick={this.closeSidebar}>
            ✕
          </button>
        </div>

        <div class="comment-list">
          {pageComments.length === 0 ? (
            <div class="empty">No comments or notes yet.</div>
          ) : (
            pageComments.map((c) => (
              <div
                class={{
                  'comment-item': true,
                  selected: c.id === this.sidebarSelectedId,
                }}
                onClick={() => this.selectSidebarComment(c.id)}
              >
                <div class="comment-meta">
                  <span class="kind-pill">{c.kind === 'comment' ? 'Comment' : 'Note'}</span>
                  <span class="meta-time">• {new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div class="comment-meta tag-line">Tag: {c.tag}</div>
                <div class="comment-text-preview">
                  {c.text ? c.text.slice(0, 80) : '(no text yet)'}
                </div>
              </div>
            ))
          )}
        </div>

        <div class="comment-editor">
          {selected ? (
            <>
              <div class="editor-meta">
                Editing {selected.kind} created {new Date(selected.createdAt).toLocaleString()}
              </div>

              <label class="tag-label">
                Tag:
                <select
                  disabled={readOnly}
                  onChange={(e: any) => (this.sidebarDraftTag = e.target.value)}
                >
                  {TAG_OPTIONS.map((t) => (
                    <option value={t} selected={this.sidebarDraftTag === t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <textarea
                value={this.sidebarDraftText}
                disabled={readOnly}
                onInput={(e: any) => (this.sidebarDraftText = e.target.value)}
                placeholder="Type annotation details here..."
              ></textarea>

              <div class="editor-buttons">
                <button disabled={readOnly} onClick={this.saveSidebarAnnotation}>
                  Save
                </button>

                <button
                  class="ai-tag-btn"
                  disabled={readOnly}
                  onClick={async () => {
                    const aiTag = await this.mockAITag(this.sidebarDraftText);
                    this.sidebarDraftTag = aiTag;
                    this.saveSidebarAnnotation();
                  }}
                >
                  🤖 Auto-Tag
                </button>

                <button
                  class="delete-btn"
                  disabled={readOnly}
                  onClick={this.deleteSidebarAnnotation}
                >
                  🗑 Delete
                </button>
              </div>
            </>
          ) : (
            <div class="editor-meta">Click a comment or note icon on the doc.</div>
          )}
        </div>
      </div>
    );
  }

  // ===== MAIN RENDER =====
  render() {
    const readOnly = this.mode === 'viewer' || this.embedded;

    return (
      <div class={`viewer-container theme-${this.theme}`}>
        {/* Toolbar hidden in embedded mode */}
        {!this.embedded && (
          <div class="toolbar">
            {/* Tools */}
            <button
              class={this.activeTool === 'select' ? 'active' : ''}
              disabled={readOnly}
              onClick={() => !readOnly && this.setTool('select')}
            >
              🖱 Select
            </button>

            <button
              class={this.activeTool === 'highlight' ? 'active' : ''}
              disabled={readOnly}
              onClick={() => !readOnly && this.setTool('highlight')}
            >
              🖍 Highlight
            </button>

            <button
              class={this.activeTool === 'comment' ? 'active' : ''}
              disabled={readOnly}
              onClick={() => !readOnly && this.setTool('comment')}
            >
              💬 Comment
            </button>

            <button
              class={this.activeTool === 'note' ? 'active' : ''}
              disabled={readOnly}
              onClick={() => !readOnly && this.setTool('note')}
            >
              📝 Note
            </button>

            <div class="toolbar-spacer" />

            {/* Undo / Redo */}
            <div class="toolbar-group">
              <button disabled={readOnly} onClick={this.undo}>
                ↩ Undo
              </button>
              <button disabled={readOnly} onClick={this.redo}>
                ↪ Redo
              </button>
            </div>

            {/* Export / Import */}
            <div class="toolbar-group">
              <button onClick={this.exportJson}>⬇ Export JSON</button>
              <button disabled={readOnly} onClick={() => this.fileInputEl?.click()}>
                ⬆ Import JSON
              </button>
              <input
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                ref={(el) => (this.fileInputEl = el as HTMLInputElement)}
                onChange={this.onImportFileChange}
              />
            </div>

            {/* Theme Switcher */}
            <div class="toolbar-group">
              <label>Theme: </label>
              <select onChange={(e: any) => this.changeTheme(e.target.value)}>
                <option value="light" selected={this.theme === "light"}>Light</option>
                <option value="dark" selected={this.theme === "dark"}>Dark</option>
                <option value="sepia" selected={this.theme === "sepia"}>Sepia</option>
              </select>

            </div>

            {/* Mode Switcher */}
            <div class="toolbar-group">
              <label>Mode: </label>
              <select onChange={(e: any) => this.changeMode(e.target.value)}>
                <option value="editor" selected={this.mode === "editor"}>Editor</option>
                <option value="viewer" selected={this.mode === "viewer"}>Viewer</option>
              </select>

            </div>
          </div>
        )}

        {/* MAIN */}
        <div class="viewer-main">
          <div class="pdf-panel">
            <div class="pages-container">
              {this.numPages === 0 ? (
                <div class="loading">Loading document…</div>
              ) : (
                Array.from({ length: this.numPages }, (_, i) => (
                 <doc-page
  src={this.src}
  page={i + 1}
  scale={this.scale}
  fileType={this.fileType}
  activeTool={this.activeTool}
  {...{ readOnly }}     // ⭐ FIXED — boolean stays boolean
  annotations={this.annotations[i + 1] || []}
  comments={this.comments[i + 1] || []}
  onAnnotationCreated={this.handleAnnotationCreated}
  onCommentAddRequested={this.handleCommentAddRequested}
  onCommentIconClicked={this.handleCommentIconClicked}
></doc-page>

                ))
              )}
            </div>
          </div>

          {/* Sidebar hidden in embedded mode */}
          {!this.embedded && this.renderSidebar()}
        </div>
      </div>
    );
  }
}
