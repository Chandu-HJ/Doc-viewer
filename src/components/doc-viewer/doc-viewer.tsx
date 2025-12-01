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

  private history = new HistoryManager<any>();

  async componentDidLoad() {
    const ann = localStorage.getItem('pdf_annotations');
    if (ann) this.annotations = JSON.parse(ann);

    const cm = localStorage.getItem('pdf_comments');
    if (cm) this.comments = JSON.parse(cm);

    const loadingTask = pdfjsLib.getDocument(this.src);
    const pdf = await loadingTask.promise;

    this.numPages = pdf.numPages;

    this.history.pushState({ annotations: this.annotations, comments: this.comments });
  }

  // === Highlight ===
  handleAnnotationCreated = (ev: CustomEvent<{ page: number; rect: NormalizedRect }>) => {
    const { page, rect } = ev.detail;
    this.pushHistory();

    const updated = { ...this.annotations };
    const list = updated[page] || [];
    list.push(rect);
    updated[page] = list;

    this.annotations = updated;
    this.persist();
  };

  // === Comment or Note Add ===
  handleCommentAddRequested = (
    ev: CustomEvent<{ page: number; x: number; y: number; kind: AnnotationKind }>
  ) => {
    this.pushHistory();

    const { page, x, y, kind } = ev.detail;
    const id = crypto.randomUUID();

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

    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = id;
    this.sidebarDraftText = '';
    this.sidebarDraftTag = 'None';
  };

  handleCommentIconClicked = (
    ev: CustomEvent<{ page: number; commentId: string }>
  ) => {
    const { page, commentId } = ev.detail;
    this.sidebarOpen = true;
    this.sidebarPage = page;
    this.sidebarSelectedId = commentId;

    const comment = this.getComment(page, commentId);
    this.sidebarDraftText = comment.text;
    this.sidebarDraftTag = comment.tag;
  };

  getComment(page: number, id: string) {
    return this.comments[page].find(c => c.id === id)!;
  }

  setTool(tool) {
    this.activeTool = tool;
  }

  pushHistory() {
    this.history.pushState({ annotations: this.annotations, comments: this.comments });
  }

  undo = () => {
    const state = this.history.undo({ annotations: this.annotations, comments: this.comments });
    if (!state) return;
    this.annotations = state.annotations;
    this.comments = state.comments;
    this.persist();
  };

  redo = () => {
    const state = this.history.redo({ annotations: this.annotations, comments: this.comments });
    if (!state) return;
    this.annotations = state.annotations;
    this.comments = state.comments;
    this.persist();
  };

  persist() {
    localStorage.setItem('pdf_annotations', JSON.stringify(this.annotations));
    localStorage.setItem('pdf_comments', JSON.stringify(this.comments));
  }

  saveSidebarAnnotation = () => {
    if (!this.sidebarPage || !this.sidebarSelectedId) return;

    this.pushHistory();

    const list = [...(this.comments[this.sidebarPage] || [])];
    const idx = list.findIndex(c => c.id === this.sidebarSelectedId);
    if (idx < 0) return;

    list[idx] = {
      ...list[idx],
      text: this.sidebarDraftText,
      tag: this.sidebarDraftTag,
    };

    this.comments = {
      ...this.comments,
      [this.sidebarPage]: list,
    };

    this.persist();
  };

  closeSidebar = () => {
    this.sidebarOpen = false;
  };

  renderSidebar() {
    if (!this.sidebarOpen || !this.sidebarPage) return null;

    const pageComments = this.comments[this.sidebarPage] || [];
    const selected = this.sidebarSelectedId
      ? this.getComment(this.sidebarPage, this.sidebarSelectedId)
      : null;

    return (
      <div class="comment-sidebar">
        <div class="sidebar-header">
          <strong>Annotations - Page {this.sidebarPage}</strong>
          <button class="close-btn" onClick={this.closeSidebar}>✕</button>
        </div>

        <div class="comment-list">
          {pageComments.map(c => (
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
              <div class="kind-pill">{c.kind.toUpperCase()}</div>
              <div style={{ fontSize: '11px' }}>
                {new Date(c.createdAt).toLocaleString()}
              </div>
              <div class="comment-text-preview">
                {c.text || 'No text'}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div class="comment-editor">
            <select
            //   value={this.sidebarDraftTag}
              onInput={(e: any) => (this.sidebarDraftTag = e.target.value)}
            >
              {TAG_OPTIONS.map(t => <option>{t}</option>)}
            </select>

            <textarea
              value={this.sidebarDraftText}
              onInput={(e: any) => (this.sidebarDraftText = e.target.value)}
            ></textarea>

            <button onClick={this.saveSidebarAnnotation}>Save</button>
          </div>
        )}
      </div>
    );
  }

  render() {
    return (
      <div class="viewer-container">
        <div class="toolbar">
          <button class={this.activeTool === 'select' ? 'active' : ''} onClick={() => this.setTool('select')}>
            🖱 Select
          </button>
          <button class={this.activeTool === 'highlight' ? 'active' : ''} onClick={() => this.setTool('highlight')}>
            🖍 Highlight
          </button>
          <button class={this.activeTool === 'comment' ? 'active' : ''} onClick={() => this.setTool('comment')}>
            💬 Comment
          </button>
          <button class={this.activeTool === 'note' ? 'active' : ''} onClick={() => this.setTool('note')}>
            📝 Note
          </button>

          <div class="undo-redo">
            <button onClick={this.undo}>↩ Undo</button>
            <button onClick={this.redo}>↪ Redo</button>
          </div>
        </div>

        <div class="viewer-main">
          <div class="pdf-panel">
            <div class="pages-container">
              {Array.from({ length: this.numPages }, (_, i) => (
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
              ))}
            </div>
          </div>

          {this.renderSidebar()}
        </div>
      </div>
    );
  }
}
