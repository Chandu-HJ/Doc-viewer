// src/components/doc-page/doc-page.tsx
import {
  Component,
  h,
  Prop,
  Element,
  Event,
  EventEmitter,
  Watch,
} from '@stencil/core';
import { NormalizedRect } from '../../types/annotations';
import { PageComment, AnnotationKind } from '../../types/comments';

const pdfjsLib = (window as any).pdfjsLib;
const pdfjsViewer = (window as any).pdfjsViewer;

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.js';

@Component({
  tag: 'doc-page',
  styleUrl: 'doc-page.css',
  shadow: false,
})
export class DocPage {
  @Element() host!: HTMLElement;

  @Prop() src!: string;
  @Prop() page!: number;
  @Prop() scale: number = 1.2;

  // pdf / image / text – given by <doc-viewer>
  @Prop() fileType: 'pdf' | 'image' | 'text' = 'pdf';

  // tools + data from parent
  @Prop() activeTool: 'select' | 'highlight' | 'comment' | 'note' = 'select';
  @Prop() annotations: NormalizedRect[] = [];
  @Prop() comments: PageComment[] = [];

  @Event() annotationCreated!: EventEmitter<{ page: number; rect: NormalizedRect }>;
  @Event() commentAddRequested!: EventEmitter<{
    page: number;
    x: number;
    y: number;
    kind: AnnotationKind;
  }>;
  @Event() commentIconClicked!: EventEmitter<{ page: number; commentId: string }>;

  private viewerContainer!: HTMLDivElement;
  private annotationLayerEl: HTMLElement | null = null;
  private textContentEl: HTMLElement | null = null;

  // drawing state for rectangle highlight (pdf + image)
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRectEl: HTMLElement | null = null;

  async componentDidLoad() {
    if (this.fileType === 'image') {
      await this.renderImagePage();
    } else if (this.fileType === 'text') {
      await this.renderTextPage();
    } else {
      await this.renderPdfPage();
    }
  }

  // ===== WATCHERS =====

  // when annotations change (undo/redo/import), redraw rectangles
  @Watch('annotations')
  annotationsChanged() {
    this.redrawHighlightsFromProps();
  }

  // when comments change, redraw icons
  @Watch('comments')
  commentsChanged() {
    this.redrawCommentsFromProps();
  }

  // when tool changes, update pointerEvents so select / text-highlight work nicely
  @Watch('activeTool')
  activeToolChanged() {
    this.updateAnnotationLayerPointer();
  }

  // ========================
  // PDF
  // ========================
  private async renderPdfPage() {
    const loadingTask = pdfjsLib.getDocument(this.src);
    const pdf = await loadingTask.promise;

    const page = await pdf.getPage(this.page);
    const viewport = page.getViewport({ scale: this.scale });
    const eventBus = new pdfjsViewer.EventBus();

    const pageView = new pdfjsViewer.PDFPageView({
      container: this.viewerContainer,
      id: this.page,
      scale: this.scale,
      defaultViewport: viewport,
      eventBus,
      textLayerMode: 2,
    });

    pageView.setPdfPage(page);
    await pageView.draw();

    const pageDiv = pageView.div as HTMLElement;
    this.setupAnnotationLayer(pageDiv);
    this.redrawHighlightsFromProps();
    this.redrawCommentsFromProps();
  }

  // ========================
  // IMAGE
  // ========================
  private async renderImagePage() {
    const pageDiv = document.createElement('div');
    pageDiv.classList.add('page');
    pageDiv.style.position = 'relative';
    this.viewerContainer.appendChild(pageDiv);

    const img = document.createElement('img');
    img.src = this.src;
    img.style.display = 'block';
    img.style.maxWidth = `${800 * this.scale}px`;

    pageDiv.appendChild(img);

    img.onload = () => {
      this.setupAnnotationLayer(pageDiv);
      this.redrawHighlightsFromProps();
      this.redrawCommentsFromProps();
    };
  }

  // ========================
  // TEXT
  // ========================
  private async renderTextPage() {
    const pageDiv = document.createElement('div');
    pageDiv.classList.add('page');
    pageDiv.style.position = 'relative';
    this.viewerContainer.appendChild(pageDiv);

    const textEl = document.createElement('pre');
    textEl.classList.add('text-content');
    textEl.style.fontSize = `${16 * this.scale}px`;
    textEl.style.whiteSpace = 'pre-wrap';

    const text = await fetch(this.src).then((r) => r.text());
    textEl.textContent = text;
    pageDiv.appendChild(textEl);
    this.textContentEl = textEl;

    this.setupAnnotationLayer(pageDiv);
    this.redrawHighlightsFromProps();
    this.redrawCommentsFromProps();

    // text highlight (pdf + text): we use selection rect for text files
    textEl.addEventListener('mouseup', (e) => this.handleTextMouseUp(e));
  }

  // ========================
  // ANNOTATION LAYER
  // ========================
  private setupAnnotationLayer(pageDiv: HTMLElement) {
    const old = pageDiv.querySelector('.annotationLayer');
    if (old) old.remove();

    const layer = document.createElement('div');
    layer.classList.add('annotationLayer');

    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '20',
    });

    this.annotationLayerEl = layer;
    this.updateAnnotationLayerPointer(layer);

    layer.addEventListener('mousedown', (e) => this.onMouseDown(e));
    layer.addEventListener('mousemove', (e) => this.onMouseMove(e));
    layer.addEventListener('mouseup', () => this.onMouseUp());

    pageDiv.appendChild(layer);
  }

  // pointer-events logic:
  // - TEXT + HIGHLIGHT → let user select text ⇒ overlay pointerEvents = none
  // - others → overlay pointerEvents = auto (so we can draw boxes / click icons)
  private updateAnnotationLayerPointer(layer?: HTMLElement) {
    const target = layer || this.annotationLayerEl;
    if (!target) return;

    if (this.fileType === 'text' && this.activeTool === 'highlight') {
      target.style.pointerEvents = 'none';
    } else {
      target.style.pointerEvents = 'auto';
    }
  }

  // ========================
  // MOUSE EVENTS (all types)
  // ========================
  private onMouseDown(e: MouseEvent) {
    if (!this.annotationLayerEl) return;

    // COMMENT / NOTE placement – all file types
    if (this.activeTool === 'comment' || this.activeTool === 'note') {
      const rect = this.annotationLayerEl.getBoundingClientRect();
      const xNorm = (e.clientX - rect.left) / rect.width;
      const yNorm = (e.clientY - rect.top) / rect.height;

      this.commentAddRequested.emit({
        page: this.page,
        x: xNorm,
        y: yNorm,
        kind: this.activeTool === 'comment' ? 'comment' : 'note',
      });
      return;
    }

    // RECTANGULAR HIGHLIGHT: PDF + IMAGE
    // For TEXT we use selection, so we skip here
    if (this.activeTool !== 'highlight' || this.fileType === 'text') return;

    this.isDrawing = true;
    const rect = this.annotationLayerEl.getBoundingClientRect();
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;

    this.currentRectEl = document.createElement('div');
    this.currentRectEl.className = 'annotationRect';
    this.currentRectEl.style.left = `${this.startX}px`;
    this.currentRectEl.style.top = `${this.startY}px`;

    this.annotationLayerEl.appendChild(this.currentRectEl);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.isDrawing || !this.currentRectEl || !this.annotationLayerEl) return;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.currentRectEl.style.width = `${x - this.startX}px`;
    this.currentRectEl.style.height = `${y - this.startY}px`;
  }

  private onMouseUp() {
    // TEXT → handled by selection handler
    if (this.fileType === 'text') return;
    if (this.activeTool !== 'highlight' || !this.annotationLayerEl) return;

    this.isDrawing = false;
    if (!this.currentRectEl) return;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    const width = parseFloat(this.currentRectEl.style.width);
    const height = parseFloat(this.currentRectEl.style.height);

    if (width > 2 && height > 2) {
      const normalized: NormalizedRect = {
        x: parseFloat(this.currentRectEl.style.left) / rect.width,
        y: parseFloat(this.currentRectEl.style.top) / rect.height,
        width: width / rect.width,
        height: height / rect.height,
      };

      this.annotationCreated.emit({ page: this.page, rect: normalized });
    }

    this.currentRectEl.remove();
    this.currentRectEl = null;
  }

  // ========================
  // TEXT SELECTION HIGHLIGHT (TEXT files only)
  // ========================
  private handleTextMouseUp(e: MouseEvent) {
    if (this.fileType !== 'text') return;
    if (this.activeTool !== 'highlight') return;
    if (!this.annotationLayerEl) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const layerRect = this.annotationLayerEl.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) return;

    const x = rect.left - layerRect.left;
    const y = rect.top - layerRect.top;
    const width = rect.width;
    const height = rect.height;

    const normalized: NormalizedRect = {
      x: x / layerRect.width,
      y: y / layerRect.height,
      width: width / layerRect.width,
      height: height / layerRect.height,
    };

    // draw local rect
    const highlightEl = document.createElement('div');
    highlightEl.className = 'annotationRect';
    highlightEl.style.left = `${x}px`;
    highlightEl.style.top = `${y}px`;
    highlightEl.style.width = `${width}px`;
    highlightEl.style.height = `${height}px`;
    this.annotationLayerEl.appendChild(highlightEl);

    // notify parent (for undo/redo + persistence)
    this.annotationCreated.emit({ page: this.page, rect: normalized });

    // optional: clear selection
    selection.removeAllRanges();
  }

  // ========================
  // REDRAW FROM PROPS (undo/redo/import)
  // ========================
  private redrawHighlightsFromProps() {
    if (!this.annotationLayerEl) return;

    // clear all existing highlight rectangles
    this.annotationLayerEl
      .querySelectorAll('.annotationRect')
      .forEach((el) => el.remove());

    const layerRect = this.annotationLayerEl.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;

    this.annotations.forEach((a) => {
      const div = document.createElement('div');
      div.className = 'annotationRect';
      div.style.left = `${a.x * layerRect.width}px`;
      div.style.top = `${a.y * layerRect.height}px`;
      div.style.width = `${a.width * layerRect.width}px`;
      div.style.height = `${a.height * layerRect.height}px`;
      this.annotationLayerEl!.appendChild(div);
    });
  }

  private redrawCommentsFromProps() {
    if (!this.annotationLayerEl) return;

    // clear existing icons
    this.annotationLayerEl
      .querySelectorAll('.comment-icon, .note-icon')
      .forEach((el) => el.remove());

    const layerRect = this.annotationLayerEl.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;

    this.comments.forEach((c) => {
      const icon = document.createElement('div');
      icon.className = c.kind === 'note' ? 'note-icon' : 'comment-icon';

      icon.style.left = `${c.x * layerRect.width}px`;
      icon.style.top = `${c.y * layerRect.height}px`;

      // emoji – already styled by your CSS
      icon.textContent = c.kind === 'note' ? '📝' : '💬';

      icon.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.commentIconClicked.emit({ page: this.page, commentId: c.id });
      });

      this.annotationLayerEl!.appendChild(icon);
    });
  }

  render() {
    return (
      <div class="page-wrapper">
        <div
          class="pdfViewerPage"
          ref={(el) => (this.viewerContainer = el as HTMLDivElement)}
        ></div>
      </div>
    );
  }
}
