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

  @Prop({ mutable: true, reflect: true }) embedded: boolean = false;

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

  // virtual / lazy: which pages are visible
  @State() visiblePages: { [page: number]: boolean } = { 1: true };

  private history = new HistoryManager<{
    annotations: Record<number, NormalizedRect[]>;
    comments: Record<number, PageComment[]>;
  }>();

  private fileInputEl?: HTMLInputElement;
  private intersectionObserver?: IntersectionObserver;

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
    const url = new URL(window.location.href);
    if (url.searchParams.get('embedded') === 'true') this.embedded = true;

    const ann = localStorage.getItem(this.storageKey('annotations'));
    if (ann) this.annotations = JSON.parse(ann);

    const cm = localStorage.getItem(this.storageKey('comments'));
    if (cm) this.comments = JSON.parse(cm);

    if (!this.fileType) this.fileType = this.detectFileType(this.src);

    if (this.fileType === 'pdf') {
      const task = pdfjsLib.getDocument(this.src);
      const pdf = await task.promise;
      this.numPages = pdf.numPages;
    } else {
      this.numPages = 1;
    }

    this.history.pushState({
      annotations: this.annotations,
      comments: this.comments,
    });

    this.setupIntersectionObserver();
  }

  private setupIntersectionObserver() {
    if (typeof IntersectionObserver === 'undefined') return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const updated = { ...this.visiblePages };
        let changed = false;

        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const pageStr = el.getAttribute('data-page');
          if (!pageStr) continue;
          const page = parseInt(pageStr, 10);
          if (!page) continue;

          if (entry.isIntersecting && !updated[page]) {
            updated[page] = true;
            changed = true;
          }
        }

        if (changed) {
          this.visiblePages = updated;
        }
      },
      {
        threshold: 0.2,
      }
    );
  }

  private observePageContainer = (el: HTMLElement | null, page: number) => {
    if (!el || !this.intersectionObserver) return;
    el.setAttribute('data-page', String(page));
    this.intersectionObserver.observe(el);
  };

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

  // ===== EVENTS FROM PAGES =====
  handleAnnotationCreated = (ev: CustomEvent<{ page: number; rect: NormalizedRect }>) => {
    const { page, rect } = ev.detail;
    this.pushHistory();

    const clone = { ...this.annotations };
    const list = clone[page] ? [...clone[page]] : [];
    list.push(rect);
    clone[page] = list;

    this.annotations = clone;
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

  // ===== SIDEBAR HELPERS =====
  private getSidebarComments() {
    if (!this.sidebarPage) return [];
    return this.comments[this.sidebarPage] || [];
  }

  private selectSidebarComment(id: string) {
    this.sidebarSelectedId = id;
    const c = this.sidebarPage ? this.getComment(this.sidebarPage, id) : null;
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

  private async mockAITag(text: string): Promise<string> {
    const t = text.toLowerCase();
    if (!t.trim()) return 'None';
    if (t.includes('?')) return 'Question';
    if (t.includes('important') || t.length > 80) return 'Important';
    if (t.includes('todo') || t.includes('fix')) return 'Todo';
    if (t.includes('idea')) return 'Idea';
    return 'Idea';
  }

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

  closeSidebar = () => {
    this.sidebarOpen = false;
    this.sidebarPage = null;
    this.sidebarSelectedId = null;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // ===== EXPORT / IMPORT (STATE) =====
  exportJson = () => {
    const data = {
      version: 1,
      src: this.src,
      fileType: this.fileType,
      theme: this.theme,
      mode: this.mode,
      activeTool: this.activeTool,
      annotations: this.annotations,
      comments: this.comments,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'doc-viewer-state.json';
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

        if (data.theme) this.theme = data.theme;
        if (data.mode) this.mode = data.mode;
        if (data.activeTool) this.activeTool = data.activeTool;
        this.persist();
      } catch {
        // ignore
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  };

  // ===== SIDEBAR UI =====
  renderSidebar() {
    if (!this.sidebarOpen || !this.sidebarPage) return null;

    const pageComments = this.getSidebarComments();
    const readOnly = this.mode === 'viewer' || this.embedded;

    const selected =
      this.sidebarSelectedId &&
      pageComments.find((c) => c.id === this.sidebarSelectedId);

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
                  <span class="meta-time"> • {new Date(c.createdAt).toLocaleString()}</span>
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
                    this.sidebarDraftTag = await this.mockAITag(this.sidebarDraftText);
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
    const pages = Array.from({ length: this.numPages || 0 }, (_, i) => i + 1);

    return (
      <div class={`viewer-container theme-${this.theme}`}>
        {/* Toolbar hidden in embedded mode */}
        {!this.embedded && (
          <div class="toolbar">
            <button
              disabled={readOnly}
              class={this.activeTool === 'select' ? 'active' : ''}
              onClick={() => this.setTool('select')}
            >
              Select
            </button>
            <button
              disabled={readOnly}
              class={this.activeTool === 'highlight' ? 'active' : ''}
              onClick={() => this.setTool('highlight')}
            >
              Highlight
            </button>
            <button
              disabled={readOnly}
              class={this.activeTool === 'comment' ? 'active' : ''}
              onClick={() => this.setTool('comment')}
            >
              Comment
            </button>
            <button
              disabled={readOnly}
              class={this.activeTool === 'note' ? 'active' : ''}
              onClick={() => this.setTool('note')}
            >
              Note
            </button>

            <div class="toolbar-spacer" />

            <button disabled={readOnly} onClick={this.undo}>
              ⤺ Undo
            </button>
            <button disabled={readOnly} onClick={this.redo}>
              ⤼ Redo
            </button>

            <div class="toolbar-spacer" />

            <button onClick={this.exportJson}>⬆ Export</button>
            <button disabled={readOnly} onClick={() => this.fileInputEl?.click()}>
              ⬇ Import
            </button>
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              ref={(el) => (this.fileInputEl = el as HTMLInputElement)}
              onChange={this.onImportFileChange}
            />

            <label>Theme:</label>
            <select onChange={(e: any) => (this.theme = e.target.value)}>
              <option value="light" selected={this.theme === 'light'}>
                Light
              </option>
              <option value="dark" selected={this.theme === 'dark'}>
                Dark
              </option>
              <option value="sepia" selected={this.theme === 'sepia'}>
                Sepia
              </option>
            </select>

            <label>Mode:</label>
            <select onChange={(e: any) => (this.mode = e.target.value)}>
              <option value="editor" selected={this.mode === 'editor'}>
                Editor
              </option>
              <option value="viewer" selected={this.mode === 'viewer'}>
                Viewer
              </option>
            </select>
          </div>
        )}

        <div class="viewer-main">
          <div
            class={{
              'pdf-panel': true,
              'has-sidebar': this.sidebarOpen,
            }}
          >
            <div class="pages-container">
              {pages.map((pageNum) => (
                <div
                  class="virtual-page-wrapper"
                  ref={(el) => this.observePageContainer(el as HTMLElement, pageNum)}
                >
                  <doc-page
                    src={this.src}
                    page={pageNum}
                    key={pageNum}
                    scale={this.scale}
                    fileType={this.fileType}
                    readOnly={readOnly}
                    activeTool={this.activeTool}
                    visible={!!this.visiblePages[pageNum]}  // ⭐ lazy render
                    annotations={this.annotations[pageNum] || []}
                    comments={this.comments[pageNum] || []}
                    onAnnotationCreated={this.handleAnnotationCreated}
                    onCommentAddRequested={this.handleCommentAddRequested}
                    onCommentIconClicked={this.handleCommentIconClicked}
                  ></doc-page>
                </div>
              ))}
            </div>
          </div>

          {!this.embedded && this.renderSidebar()}
        </div>
      </div>
    );
  }
}
