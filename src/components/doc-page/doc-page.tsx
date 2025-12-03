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
  @Prop() fileType: 'pdf' | 'image' | 'text' = 'pdf';

  @Prop() activeTool: 'select' | 'highlight' | 'comment' | 'note' = 'select';

  // readOnly = true → no drawing/adding annotations
  @Prop() readOnly: boolean = false;

  // virtual / lazy rendering flag
  @Prop() visible: boolean = false;

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

  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRectEl: HTMLElement | null = null;

  private hasRendered = false; // for lazy load

  async componentDidLoad() {
    await this.ensureRendered();
  }

  @Watch('visible')
  async visibleChanged() {
    await this.ensureRendered();
  }

  @Watch('annotations')
  annotationsChanged() {
    this.redrawHighlightsFromProps();
  }

  @Watch('comments')
  commentsChanged() {
    this.redrawCommentsFromProps();
  }

  // ========== LAZY RENDERING ==========
  private async ensureRendered() {
    if (!this.visible) return;       // not in viewport yet
    if (this.hasRendered) return;    // already rendered once

    this.hasRendered = true;

    if (this.fileType === 'image') {
      await this.renderImagePage();
    } else if (this.fileType === 'text') {
      await this.renderTextPage();
    } else {
      await this.renderPdfPage();
    }
  }

  // ========== RENDER TYPES ==========
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

    // ✅ Make sure layout is fully done before creating annotation layer
    const setup = () => {
      this.setupAnnotationLayer(pageDiv);
      this.redrawHighlightsFromProps();
      this.redrawCommentsFromProps();
    };

    // double RAF → next layout + next paint
    requestAnimationFrame(() => {
      requestAnimationFrame(setup);
    });
  }

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

    this.setupAnnotationLayer(pageDiv);
    this.redrawHighlightsFromProps();
    this.redrawCommentsFromProps();

    textEl.addEventListener('mouseup', () => this.handleTextMouseUp());
  }

  // ========== ANNOTATION LAYER ==========
  private setupAnnotationLayer(pageDiv: HTMLElement) {
    const old = pageDiv.querySelector('.annotationLayer');
    if (old) old.remove();

    const layer = document.createElement('div');
    layer.classList.add('annotationLayer');
    Object.assign(layer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '999',        // ensure it is on top of canvas/text
      pointerEvents: 'auto',
    });

    this.annotationLayerEl = layer;
    pageDiv.appendChild(layer);

    if (!this.readOnly) {
      layer.addEventListener('mousedown', (e) => this.onMouseDown(e));
      layer.addEventListener('mousemove', (e) => this.onMouseMove(e));
      layer.addEventListener('mouseup', () => this.onMouseUp());
    } else {
      if (this.activeTool === 'select') {
  layer.style.pointerEvents = 'none';

  // but allow icons to be clicked
  layer.querySelectorAll('.comment-icon, .note-icon').forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'auto';
  });
} else {
  layer.style.pointerEvents = 'auto';
}


    }
  }
@Watch('activeTool')
@Watch('activeTool')
activeToolChanged() {
  if (!this.annotationLayerEl) return;

  // SELECT MODE → allow clicking icons, allow text select, block drawing
  if (this.activeTool === 'select') {
    // fully pass-through except icons
    this.annotationLayerEl.style.pointerEvents = 'none';

    // restore icon clickability
    this.annotationLayerEl.querySelectorAll('.comment-icon, .note-icon').forEach((el) => {
      (el as HTMLElement).style.pointerEvents = 'auto';
    });

    return;
  }

  // OTHER TOOLS (highlight/comment/note)
  this.annotationLayerEl.style.pointerEvents = 'auto';
}


  // ========== MOUSE HANDLERS ==========
  private onMouseDown(e: MouseEvent) {
    if (!this.annotationLayerEl || this.readOnly) return;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // COMMENT / NOTE
    if (this.activeTool === 'comment' || this.activeTool === 'note') {
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

    // HIGHLIGHT (pdf/image only)
    if (this.activeTool !== 'highlight' || this.fileType === 'text') return;

    this.isDrawing = true;
    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;

    this.currentRectEl = document.createElement('div');
    this.currentRectEl.className = 'annotationRect';
    this.currentRectEl.style.left = `${this.startX}px`;
    this.currentRectEl.style.top = `${this.startY}px`;

    this.annotationLayerEl.appendChild(this.currentRectEl);
  }

  private onMouseMove(e: MouseEvent) {
    if (this.readOnly) return;
    if (!this.isDrawing || !this.currentRectEl || !this.annotationLayerEl) return;

    const rect = this.annotationLayerEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.currentRectEl.style.width = `${x - this.startX}px`;
    this.currentRectEl.style.height = `${y - this.startY}px`;
  }

  private onMouseUp() {
    if (this.readOnly) return;
    if (!this.isDrawing || !this.annotationLayerEl || !this.currentRectEl) return;

    this.isDrawing = false;

    const layerRect = this.annotationLayerEl.getBoundingClientRect();
    const width = parseFloat(this.currentRectEl.style.width || '0');
    const height = parseFloat(this.currentRectEl.style.height || '0');

    if (width > 3 && height > 3 && layerRect.width && layerRect.height) {
      const normalized: NormalizedRect = {
        x: parseFloat(this.currentRectEl.style.left || '0') / layerRect.width,
        y: parseFloat(this.currentRectEl.style.top || '0') / layerRect.height,
        width: width / layerRect.width,
        height: height / layerRect.height,
      };

      this.annotationCreated.emit({ page: this.page, rect: normalized });
    }

    this.currentRectEl.remove();
    this.currentRectEl = null;
  }

  // ========== TEXT HIGHLIGHT ==========
  private handleTextMouseUp() {
  if (this.readOnly) return;
  if (this.fileType !== 'text') return;
  if (this.activeTool !== 'highlight') return;
  if (!this.annotationLayerEl) return;

  // allow text selection
  this.annotationLayerEl.style.pointerEvents = 'none';

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    this.annotationLayerEl.style.pointerEvents = 'auto';
    return;
  }

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  sel.removeAllRanges();

  const layerRect = this.annotationLayerEl.getBoundingClientRect();
  if (!layerRect.width || !layerRect.height || !rect.width || !rect.height) {
    this.annotationLayerEl.style.pointerEvents = 'auto';
    return;
  }

  const x = rect.left - layerRect.left;
  const y = rect.top - layerRect.top;

  const normalized = {
    x: x / layerRect.width,
    y: y / layerRect.height,
    width: rect.width / layerRect.width,
    height: rect.height / layerRect.height,
  };

  const el = document.createElement('div');
  el.className = 'annotationRect';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;

  this.annotationLayerEl.appendChild(el);

  // restore clickability
  this.annotationLayerEl.style.pointerEvents = 'auto';

  this.annotationCreated.emit({ page: this.page, rect: normalized });
}


  // ========== REDRAW HIGHLIGHTS ==========
  private redrawHighlightsFromProps() {
    if (!this.annotationLayerEl) return;

    this.annotationLayerEl.querySelectorAll('.annotationRect').forEach((el) => el.remove());

    const layerRect = this.annotationLayerEl.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;

    this.annotations.forEach((a) => {
      const el = document.createElement('div');
      el.className = 'annotationRect';
      el.style.left = `${a.x * layerRect.width}px`;
      el.style.top = `${a.y * layerRect.height}px`;
      el.style.width = `${a.width * layerRect.width}px`;
      el.style.height = `${a.height * layerRect.height}px`;
      this.annotationLayerEl!.appendChild(el);
    });
  }

  // ========== REDRAW COMMENTS + NOTES (WITH NOTE BUBBLE) ==========
  private redrawCommentsFromProps() {
    if (!this.annotationLayerEl) return;

    // Remove old icons + bubbles
    this.annotationLayerEl
      .querySelectorAll('.comment-icon, .note-icon, .note-bubble')
      .forEach((el) => el.remove());

    const layerRect = this.annotationLayerEl.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height) return;

    this.comments.forEach((c) => {
      const isNote = c.kind === 'note';
      const pxX = c.x * layerRect.width;
      const pxY = c.y * layerRect.height;

      // Create icon
      const icon = document.createElement('div');
      icon.className = isNote ? 'note-icon' : 'comment-icon';
      icon.textContent = isNote ? '📝' : '💬';
      icon.style.left = `${pxX}px`;
      icon.style.top = `${pxY}px`;

      // --- COMMENTS (💬) → icon only, click = open sidebar
      if (!isNote) {
        icon.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.commentIconClicked.emit({ page: this.page, commentId: c.id });
        });
        this.annotationLayerEl!.appendChild(icon);
        return;
      }

      // --- NOTES (📝) → icon + popup text bubble
      const bubble = document.createElement('div');
      bubble.className = 'note-bubble';
      bubble.textContent = c.text && c.text.trim() !== '' ? c.text : '(empty note)';

      // Place near icon
      bubble.style.left = `${pxX}px`;
      bubble.style.top = `${pxY}px`;

      // Decide left/right based on available space
      const placeRight = pxX < layerRect.width * 0.6;
      bubble.classList.add(placeRight ? 'right' : 'left');

      // Hover → show
      icon.addEventListener('mouseenter', () => {
        bubble.classList.add('visible');
      });
      icon.addEventListener('mouseleave', () => {
        bubble.classList.remove('visible');
      });

      // Click → toggle + open sidebar
      icon.addEventListener('click', (ev) => {
        ev.stopPropagation();
        bubble.classList.toggle('visible');
        this.commentIconClicked.emit({ page: this.page, commentId: c.id });
      });

      this.annotationLayerEl!.appendChild(bubble);
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
