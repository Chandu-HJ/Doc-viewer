// src/components/doc-page/doc-page.tsx
import {
  Component,
  h,
  Prop,
  Element,
  Event,
  EventEmitter,
  Watch,
  State,
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
  @Prop() fileType: 'pdf' | 'image' | 'text' = 'pdf';

  @Prop() activeTool: 'select' | 'highlight' | 'comment' | 'note' = 'select';

  // viewer or embedded → readOnly = true
  @Prop({ mutable: true, reflect: true }) readOnly: boolean = false;

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

  // drawing
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRectEl: HTMLElement | null = null;

  // dragging/resizing
  @State() draggingEl: HTMLElement | null = null;
  @State() resizingEl: HTMLElement | null = null;
  @State() dragOffsetX = 0;
  @State() dragOffsetY = 0;

  async componentDidLoad() {
    if (this.fileType === 'image') {
      await this.renderImagePage();
    } else if (this.fileType === 'text') {
      await this.renderTextPage();
    } else {
      await this.renderPdfPage();
    }
  }

  @Watch('annotations')
  annotationsChanged() {
    this.redrawHighlightsFromProps();
  }

  @Watch('comments')
  commentsChanged() {
    this.redrawCommentsFromProps();
  }

  // ------------------------------------------------------
  // RENDER PDF
  // ------------------------------------------------------
  private async renderPdfPage() {
    const loadingTask = pdfjsLib.getDocument(this.src);
    const pdf = await loadingTask.promise;
    const pdfPage = await pdf.getPage(this.page);

    const viewport = pdfPage.getViewport({ scale: this.scale });

    const eventBus = new pdfjsViewer.EventBus();
    const pageView = new pdfjsViewer.PDFPageView({
      container: this.viewerContainer,
      id: this.page,
      scale: this.scale,
      defaultViewport: viewport,
      eventBus,
      textLayerMode: 2,
    });

    pageView.setPdfPage(pdfPage);
    await pageView.draw();

    // PDF.js creates layers asynchronously → wait
    setTimeout(() => {
      const pageDiv = pageView.div as HTMLElement;

      // Fix text layer so it doesn't block pointer events
      const textLayer = pageDiv.querySelector('.textLayer') as HTMLElement;
      if (textLayer) {
        textLayer.style.pointerEvents = 'none';
        textLayer.style.zIndex = '5';
      }

      this.setupAnnotationLayer(pageDiv);
      this.redrawHighlightsFromProps();
      this.redrawCommentsFromProps();
    }, 30);
  }

  // ------------------------------------------------------
  // IMAGE
  // ------------------------------------------------------
  private async renderImagePage() {
    const pageDiv = document.createElement('div');
    pageDiv.classList.add('page');
    pageDiv.style.position = 'relative';
    this.viewerContainer.appendChild(pageDiv);

    const img = document.createElement('img');
    img.src = this.src;
    img.style.maxWidth = `${800 * this.scale}px`;
    img.style.display = 'block';

    pageDiv.appendChild(img);

    img.onload = () => {
      this.setupAnnotationLayer(pageDiv);
      this.redrawHighlightsFromProps();
      this.redrawCommentsFromProps();
    };
  }

  // ------------------------------------------------------
  // TEXT FILE
  // ------------------------------------------------------
  private async renderTextPage() {
    const pageDiv = document.createElement('div');
    pageDiv.classList.add('page');
    pageDiv.style.position = 'relative';

    this.viewerContainer.appendChild(pageDiv);

    const textEl = document.createElement('pre');
    textEl.style.fontSize = `${16 * this.scale}px`;
    textEl.style.whiteSpace = 'pre-wrap';

    const text = await fetch(this.src).then((r) => r.text());
    textEl.textContent = text;

    pageDiv.appendChild(textEl);

    this.setupAnnotationLayer(pageDiv);
    this.redrawHighlightsFromProps();
    this.redrawCommentsFromProps();

    textEl.addEventListener('mouseup', () => this.handleTextMouseUp());
  }

  // ------------------------------------------------------
  // ANNOTATION LAYER
  // ------------------------------------------------------
  private setupAnnotationLayer(pageDiv: HTMLElement) {
    const old = pageDiv.querySelector('.annotationLayer');
    if (old) old.remove();

    const layer = document.createElement('div');
    layer.classList.add('annotationLayer');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '50',
      pointerEvents: 'auto',
    });

    this.annotationLayerEl = layer;

    layer.addEventListener('mousedown', (e) => this.onMouseDown(e));
    layer.addEventListener('mousemove', (e) => this.onMouseMove(e));
    layer.addEventListener('mouseup', () => this.onMouseUp());

    pageDiv.appendChild(layer);
  }

  // ------------------------------------------------------
  // DRAWING (highlight rectangles)
  // ------------------------------------------------------
  private onMouseDown(e: MouseEvent) {
    if (!this.annotationLayerEl || this.readOnly) return;

    // place comment/note
    if (this.activeTool === 'comment' || this.activeTool === 'note') {
      const rect = this.annotationLayerEl.getBoundingClientRect();
      const xNorm = (e.clientX - rect.left) / rect.width;
      const yNorm = (e.clientY - rect.top) / rect.height;

      this.commentAddRequested.emit({
        page: this.page,
        x: xNorm,
        y: yNorm,
        kind: this.activeTool,
      });
      return;
    }

    // dragging/resizing?
    const target = e.target as HTMLElement;
    if (target.classList.contains('annotationRect')) {
      this.draggingEl = target;
      const r = target.getBoundingClientRect();
      this.dragOffsetX = e.clientX - r.left;
      this.dragOffsetY = e.clientY - r.top;
      return;
    }

    if (target.classList.contains('resize-handle')) {
      this.resizingEl = target.parentElement as HTMLElement;
      return;
    }

    // drawing rectangle
    if (this.activeTool !== 'highlight') return;

    this.isDrawing = true;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;

    const el = document.createElement('div');
    el.className = 'annotationRect';
    el.style.left = `${this.startX}px`;
    el.style.top = `${this.startY}px`;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    this.currentRectEl = el;
    this.annotationLayerEl.appendChild(el);
  }

  private onMouseMove(e: MouseEvent) {
    if (this.readOnly || !this.annotationLayerEl) return;

    // dragging
    if (this.draggingEl) {
      const rect = this.annotationLayerEl.getBoundingClientRect();
      const x = e.clientX - rect.left - this.dragOffsetX;
      const y = e.clientY - rect.top - this.dragOffsetY;

      this.draggingEl.style.left = `${x}px`;
      this.draggingEl.style.top = `${y}px`;
      return;
    }

    // resizing
    if (this.resizingEl) {
      const rect = this.annotationLayerEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const left = parseFloat(this.resizingEl.style.left);
      const top = parseFloat(this.resizingEl.style.top);

      this.resizingEl.style.width = `${x - left}px`;
      this.resizingEl.style.height = `${y - top}px`;
      return;
    }

    // drawing
    if (!this.isDrawing || !this.currentRectEl) return;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.currentRectEl.style.width = `${x - this.startX}px`;
    this.currentRectEl.style.height = `${y - this.startY}px`;
  }

  private onMouseUp() {
    if (this.draggingEl) {
      this.draggingEl = null;
      return;
    }
    if (this.resizingEl) {
      this.resizingEl = null;
      return;
    }
    if (!this.isDrawing || !this.annotationLayerEl || !this.currentRectEl)
      return;

    this.isDrawing = false;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    const width = parseFloat(this.currentRectEl.style.width);
    const height = parseFloat(this.currentRectEl.style.height);

    if (width > 3 && height > 3) {
      const normalized: NormalizedRect = {
        x: parseFloat(this.currentRectEl.style.left) / rect.width,
        y: parseFloat(this.currentRectEl.style.top) / rect.height,
        width: width / rect.width,
        height: height / rect.height,
      };
      this.annotationCreated.emit({ page: this.page, rect: normalized });
    }

    // leave element for rendering logic
    this.currentRectEl = null;
  }

  // ------------------------------------------------------
  // TEXT HIGHLIGHT
  // ------------------------------------------------------
  private handleTextMouseUp() {
    if (this.readOnly) return;
    if (this.fileType !== 'text') return;
    if (this.activeTool !== 'highlight') return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);git 
    const r = range.getBoundingClientRect();

    sel.removeAllRanges();

    if (!this.annotationLayerEl) return;
    const layerRect = this.annotationLayerEl.getBoundingClientRect();

    const x = r.left - layerRect.left;
    const y = r.top - layerRect.top;

    const normalized: NormalizedRect = {
      x: x / layerRect.width,
      y: y / layerRect.height,
      width: r.width / layerRect.width,
      height: r.height / layerRect.height,
    };

    this.annotationCreated.emit({ page: this.page, rect: normalized });
  }

  // ------------------------------------------------------
  // REDRAW FROM PROPS
  // ------------------------------------------------------
  private redrawHighlightsFromProps() {
    if (!this.annotationLayerEl) return;

    this.annotationLayerEl.querySelectorAll('.annotationRect').forEach((el) =>
      el.remove()
    );

    const rect = this.annotationLayerEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    this.annotations.forEach((a) => {
      const el = document.createElement('div');
      el.className = 'annotationRect';
      el.style.left = `${a.x * rect.width}px`;
      el.style.top = `${a.y * rect.height}px`;
      el.style.width = `${a.width * rect.width}px`;
      el.style.height = `${a.height * rect.height}px`;

      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      el.appendChild(handle);

      this.annotationLayerEl!.appendChild(el);
    });
  }

  private redrawCommentsFromProps() {
    if (!this.annotationLayerEl) return;

    this.annotationLayerEl
      .querySelectorAll('.comment-icon, .note-icon')
      .forEach((el) => el.remove());

    const rect = this.annotationLayerEl.getBoundingClientRect();

    this.comments.forEach((c) => {
      const icon = document.createElement('div');
      icon.className = c.kind === 'note' ? 'note-icon' : 'comment-icon';
      icon.textContent = c.kind === 'note' ? '📝' : '💬';

      icon.style.left = `${c.x * rect.width}px`;
      icon.style.top = `${c.y * rect.height}px`;

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
