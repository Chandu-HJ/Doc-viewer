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

  // Embedded mode = viewer only + no toolbar
  @Prop({ mutable: true, reflect: true }) embedded: boolean = false;

  // Theme and mode
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

  private fileInputEl?: HTMLInputElement;

  private history = new HistoryManager<{
    annotations: Record<number, NormalizedRect[]>;
    comments: Record<number, PageComment[]>;
  }>();

  // --------------------
  // STORAGE KEYS
  // --------------------
  private storageKey(kind: 'annotations' | 'comments'): string {
    const safe = (this.src || 'file').replace(/[^a-z0-9]/gi, '_');
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
    // check for ?embedded=true
    const url = new URL(window.location.href);
    if (url.searchParams.get('embedded') === 'true') this.embedded = true;

    // load storage
    const a = localStorage.getItem(this.storageKey('annotations'));
    if (a) this.annotations = JSON.parse(a);
    const c = localStorage.getItem(this.storageKey('comments'));
    if (c) this.comments = JSON.parse(c);

    // auto detect file type
    if (!this.fileType) this.fileType = this.detectFileType(this.src);

    // load page count
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
  }

  // --------------------
  // HISTORY
  // --------------------
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
    const s = this.history.undo({
      annotations: this.annotations,
      comments: this.comments,
    });
    if (!s) return;
    this.annotations = s.annotations;
    this.comments = s.comments;
    this.persist();
  };

  redo = () => {
    const s = this.history.redo({
      annotations: this.annotations,
      comments: this.comments,
    });
    if (!s) return;
    this.annotations = s.annotations;
    this.comments = s.comments;
    this.persist();
  };

  // --------------------
  // EVENT HANDLERS
  // --------------------
  handleAnnotationCreated = (ev: CustomEvent<{ page: number; rect: NormalizedRect }>) => {
    this.pushHistory();
    const { page, rect } = ev.detail;

    const copy = { ...this.annotations };
    const list = copy[page] || [];
    copy[page] = [...list, rect];

    this.annotations = copy;
    this.persist();
  };

  handleCommentAddRequested = (
    ev: CustomEvent<{ page: number; x: number; y: number; kind: AnnotationKind }>
  ) => {
    this.pushHistory();

    const { page, x, y, kind } = ev.detail;

    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

    const newComment: PageComment = {
      id,
      kind,
      x,
      y,
      text: '',
      tag: 'None',
      createdAt: new Date().toISOString(),
    };

    const copy = { ...this.comments };
    const list = copy[page] || [];
    copy[page] = [...list, newComment];

    this.comments = copy;
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
    return (this.comments[page] || []).find((c) => c.id === id) || null;
  }

  // --------------------
  // SIDEBAR SAVE / DELETE
  // --------------------
  saveSidebarAnnotation = () => {
    if (!this.sidebarSelectedId || !this.sidebarPage) return;

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

  deleteSidebarAnnotation = () => {
    if (!this.sidebarSelectedId || !this.sidebarPage) return;

    this.pushHistory();
    const page = this.sidebarPage;

    const updated = (this.comments[page] || []).filter(
      (c) => c.id !== this.sidebarSelectedId,
    );

    this.comments = { ...this.comments, [page]: updated };
    this.persist();

    this.sidebarSelectedId = null;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // --------------------
  // EXPORT / IMPORT
  // --------------------
  exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ annotations: this.annotations, comments: this.comments }, null, 2)],
      { type: 'application/json' },
    );
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
      } catch { }
    };
    reader.readAsText(file);
  };

  // --------------------
  // MOCK AI TAGGING
  // --------------------
  private async mockAITag(text: string) {
    const t = text.toLowerCase();

    if (!t.trim()) return 'None';
    if (t.includes('important')) return 'Important';
    if (t.includes('?')) return 'Question';
    if (t.includes('todo') || t.includes('fix')) return 'Todo';
    if (t.includes('idea')) return 'Idea';
    return 'Idea';
  }

  // --------------------
  // SIDEBAR RENDER
  // --------------------
  private getSidebarComments() {
    if (!this.sidebarPage) return [];
    return this.comments[this.sidebarPage] || [];
  }

  private renderSidebar() {
    if (!this.sidebarOpen || !this.sidebarPage) return null;

    const items = this.getSidebarComments();
    const selected = this.sidebarSelectedId
      ? items.find((c) => c.id === this.sidebarSelectedId)
      : null;

    const readOnly = this.mode === 'viewer' || this.embedded;

    return (
      <div class="comment-sidebar">
        <div class="sidebar-header">
          <strong>Page {this.sidebarPage}</strong>
          <button onClick={() => (this.sidebarOpen = false)}>✕</button>
        </div>

        <div class="comment-list">
          {items.map((c) => (
            <div
              class={{
                'comment-item': true,
                selected: c.id === this.sidebarSelectedId,
              }}
              onClick={() => {
                this.sidebarSelectedId = c.id;
                this.sidebarDraftText = c.text;
                this.sidebarDraftTag = c.tag;
              }}
            >
              <div class="meta">
                <b>{c.kind === 'note' ? 'Note' : 'Comment'}</b> •{' '}
                {new Date(c.createdAt).toLocaleString()}
              </div>
              <div>Tag: {c.tag}</div>
              <div>{c.text ? c.text.slice(0, 60) : '(empty)'}</div>
            </div>
          ))}
        </div>

        {selected ? (
          <div class="comment-editor">
            <textarea
              disabled={readOnly}
              value={this.sidebarDraftText}
              onInput={(e: any) => (this.sidebarDraftText = e.target.value)}
            ></textarea>

            <select
              disabled={readOnly}
              onChange={(e: any) => (this.sidebarDraftTag = e.target.value)}
            >
              {TAG_OPTIONS.map((t) => (
                <option value={t} selected={t === this.sidebarDraftTag}>
                  {t}
                </option>
              ))}
            </select>

            <div class="editor-buttons">
              <button disabled={readOnly} onClick={this.saveSidebarAnnotation}>
                Save
              </button>

              <button
                disabled={readOnly}
                onClick={async () => {
                  this.sidebarDraftTag = await this.mockAITag(this.sidebarDraftText);
                  this.saveSidebarAnnotation();
                }}
              >
                🤖 Auto-Tag
              </button>

              <button disabled={readOnly} onClick={this.deleteSidebarAnnotation}>
                🗑 Delete
              </button>
            </div>
          </div>
        ) : (
          <div class="empty-editor">Select an annotation</div>
        )}
      </div>
    );
  }

  // --------------------
  // MAIN RENDER
  // --------------------
  render() {
    const readOnly = this.mode === 'viewer' || this.embedded;

    return (
      <div class={`viewer-container theme-${this.theme}`}>
        {/* Toolbar hidden in embedded mode */}
        {!this.embedded && (
          <div class="toolbar">
            {/* Tools */}
            <button disabled={readOnly} onClick={() => (this.activeTool = 'select')}>
              Select
            </button>
            <button disabled={readOnly} onClick={() => (this.activeTool = 'highlight')}>
              Highlight
            </button>
            <button disabled={readOnly} onClick={() => (this.activeTool = 'comment')}>
              Comment
            </button>
            <button disabled={readOnly} onClick={() => (this.activeTool = 'note')}>
              Note
            </button>

            <div class="spacer"></div>

            {/* Undo/Redo */}
            <button disabled={readOnly} onClick={this.undo}>
              ⤺ Undo
            </button>
            <button disabled={readOnly} onClick={this.redo}>
              ⤼ Redo
            </button>

            <div class="spacer"></div>

            {/* JSON */}
            <button onClick={this.exportJson}>⬇ Export</button>
            <button disabled={readOnly} onClick={() => this.fileInputEl?.click()}>
              ⬆ Import
            </button>
            <input
              type="file"
              style={{ display: 'none' }}
              ref={(el) => (this.fileInputEl = el as HTMLInputElement)}
              onChange={this.onImportFileChange}
            />

            {/* Theme */}
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

            {/* Mode */}
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

          {/* PDF SCROLL AREA */}
          <div
            class={{
              "pdf-panel": true,
              "has-sidebar": this.sidebarOpen   // ⭐ shifts PDF when sidebar is open
            }}
          >
            <div class="pages-container">
              {Array.from({ length: this.numPages }, (_, i) => (
                <doc-page
                  src={this.src}
                  page={i + 1}
                  key={i}
                  scale={this.scale}
                  fileType={this.fileType}
                  readOnly={readOnly}
                  activeTool={this.activeTool}
                  annotations={this.annotations[i + 1] || []}
                  comments={this.comments[i + 1] || []}
                  onAnnotationCreated={this.handleAnnotationCreated}
                  onCommentAddRequested={this.handleCommentAddRequested}
                  onCommentIconClicked={this.handleCommentIconClicked}
                ></doc-page>
              ))}
            </div>
          </div>

          {/* SIDEBAR */}
          {!this.embedded && this.renderSidebar()}
        </div>

      </div>
    );
  }
}
