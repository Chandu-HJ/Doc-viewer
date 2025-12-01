// src/components/doc-viewer/doc-viewer.tsx
import { Component, h, Prop, State } from '@stencil/core';
import { NormalizedRect } from '../../types/annotations';
import { PageComment, AnnotationKind } from '../../types/comments';
import { HistoryManager } from '../../utils/history';

const pdfjsLib = (window as any).pdfjsLib;
const TAG_OPTIONS = ['None', 'Important', 'Todo', 'Question', 'Idea'];

@Component({
  tag: 'doc-viewer',
  styleUrl: 'doc-viewer.css',
  shadow: false,
})
export class DocViewer {
  @Prop() src!: string;
  @Prop() scale: number = 1.2;

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

  async componentDidLoad() {
    const ann = localStorage.getItem('pdf_annotations');
    if (ann) this.annotations = JSON.parse(ann);

    const cm = localStorage.getItem('pdf_comments');
    if (cm) this.comments = JSON.parse(cm);

    const loadingTask = pdfjsLib.getDocument(this.src);
    const pdf = await loadingTask.promise;
    this.numPages = pdf.numPages;

    this.history.pushState({
      annotations: this.annotations,
      comments: this.comments,
    });
  }

  // ========== HISTORY HELPERS ==========
  private pushHistory() {
    this.history.pushState({
      annotations: this.annotations,
      comments: this.comments,
    });
  }

  private persist() {
    localStorage.setItem('pdf_annotations', JSON.stringify(this.annotations));
    localStorage.setItem('pdf_comments', JSON.stringify(this.comments));
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

  // ========== HIGHLIGHT CREATED BY CHILD ==========
  handleAnnotationCreated = (
    ev: CustomEvent<{ page: number; rect: NormalizedRect }>
  ) => {
    const { page, rect } = ev.detail;
    this.pushHistory();

    const updated = { ...this.annotations };
    const list = updated[page] || [];
    list.push(rect);
    updated[page] = list;

    this.annotations = updated;
    this.persist();
  };

  // ========== COMMENT / NOTE CREATED BY CLICK ==========
  handleCommentAddRequested = (
    ev: CustomEvent<{ page: number; x: number; y: number; kind: AnnotationKind }>
  ) => {
    this.pushHistory();

    const { page, x, y, kind } = ev.detail;
    const id =
      (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    const updated = { ...this.comments };
    const list = updated[page] || [];

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

    // Open sidebar focusing on this annotation
    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = id;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // ========== COMMENT ICON CLICKED ==========
  handleCommentIconClicked = (
    ev: CustomEvent<{ page: number; commentId: string }>
  ) => {
    const { page, commentId } = ev.detail;
    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = commentId;

    const comment = this.getComment(page, commentId);
    if (comment) {
      this.sidebarDraftText = comment.text;
      this.sidebarDraftTag = comment.tag || 'None';
    }
  };

  private getComment(page: number, id: string) {
    const list = this.comments[page] || [];
    return list.find((c) => c.id === id) || null;
  }

  // ========== TOOLBAR ==========
  setTool(tool: 'select' | 'highlight' | 'comment' | 'note') {
    this.activeTool = tool;
  }

  // ========== SIDEBAR HELPERS ==========
  private getSidebarComments(): PageComment[] {
    if (!this.sidebarPage) return [];
    return this.comments[this.sidebarPage] || [];
  }

  private getSelectedComment(): PageComment | null {
    if (!this.sidebarPage || !this.sidebarSelectedId) return null;
    const list = this.comments[this.sidebarPage] || [];
    return list.find((c) => c.id === this.sidebarSelectedId) || null;
  }

  private selectSidebarComment(id: string) {
    this.sidebarSelectedId = id;
    const c = this.getSelectedComment();
    if (c) {
      this.sidebarDraftText = c.text;
      this.sidebarDraftTag = c.tag || 'None';
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

    this.comments = {
      ...this.comments,
      [page]: list,
    };

    this.persist();
  };

  closeSidebar = () => {
    this.sidebarOpen = false;
    this.sidebarPage = null;
    this.sidebarSelectedId = null;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  // ========== EXPORT / IMPORT JSON ==========
  exportJson = () => {
    const data = {
      annotations: this.annotations,
      comments: this.comments,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
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
      } catch (err) {
        console.error('Invalid annotations JSON', err);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };

  // ========== SIDEBAR RENDER ==========
  renderSidebar() {
    if (!this.sidebarOpen || !this.sidebarPage) return null;

    const pageComments = this.getSidebarComments();
    const selected = this.getSelectedComment();

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
                  <span class="kind-pill">
                    {c.kind === 'comment' ? 'Comment' : 'Note'}
                  </span>
                  <span class="meta-time">
                    • {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <div class="comment-meta tag-line">
                  Tag: {c.tag || 'None'}
                </div>
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
                Editing {selected.kind} created{' '}
                {new Date(selected.createdAt).toLocaleString()}
              </div>
              <label class="tag-label">
                Tag:{' '}
                <select
                //   value={this.sidebarDraftTag}
                  onInput={(e: any) =>
                    (this.sidebarDraftTag = e.target.value)
                  }
                >
                  {TAG_OPTIONS.map((t) => (
                    <option value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <textarea
                value={this.sidebarDraftText}
                onInput={(e: any) =>
                  (this.sidebarDraftText = e.target.value)
                }
                placeholder="Type annotation details here..."
              ></textarea>
              <button onClick={this.saveSidebarAnnotation}>Save</button>
            </>
          ) : (
            <div class="editor-meta">
              Click a comment or note icon on the PDF, or a list item above.
            </div>
          )}
        </div>
      </div>
    );
  }

  render() {
    return (
      <div class="viewer-container">
        {/* Toolbar */}
        <div class="toolbar">
          <button
            class={this.activeTool === 'select' ? 'active' : ''}
            onClick={() => this.setTool('select')}
          >
            🖱 Select
          </button>
          <button
            class={this.activeTool === 'highlight' ? 'active' : ''}
            onClick={() => this.setTool('highlight')}
          >
            🖍 Highlight
          </button>
          <button
            class={this.activeTool === 'comment' ? 'active' : ''}
            onClick={() => this.setTool('comment')}
          >
            💬 Comment
          </button>
          <button
            class={this.activeTool === 'note' ? 'active' : ''}
            onClick={() => this.setTool('note')}
          >
            📝 Note
          </button>

          <div class="toolbar-spacer" />

          <div class="undo-redo">
            <button onClick={this.undo}>↩ Undo</button>
            <button onClick={this.redo}>↪ Redo</button>
          </div>

          <div class="export-import">
            <button onClick={this.exportJson}>⬇ Export JSON</button>
            <button
              onClick={() => this.fileInputEl && this.fileInputEl.click()}
            >
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
        </div>

        {/* Main viewer area */}
        <div class="viewer-main">
          <div class="pdf-panel">
            <div class="pages-container">
              {this.numPages === 0 ? (
                <div class="loading">Loading PDF…</div>
              ) : (
                Array.from({ length: this.numPages }, (_, i) => (
                  <doc-page
                    src={this.src}
                    page={i + 1}
                    scale={this.scale}
                    activeTool={this.activeTool}
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

          {this.renderSidebar()}
        </div>
      </div>
    );
  }
}
