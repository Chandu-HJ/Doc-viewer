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
  private pageDiv: HTMLElement | null = null;
  private annotationLayerEl: HTMLDivElement | null = null;

  // highlight drawing
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRectEl: HTMLElement | null = null;

  async componentDidLoad() {
    await this.loadPage();
  }

  @Watch('comments')
  commentsChanged() {
    this.drawCommentsFromProps();
  }

  @Watch('activeTool')
  activeToolChanged(newVal: 'select' | 'highlight' | 'comment' | 'note') {
    if (!this.annotationLayerEl) return;

    // For select mode -> allow text selection (overlay off)
    // For highlight/comment/note -> overlay intercepts for drawing/click
    if (newVal === 'select') {
      this.annotationLayerEl.style.pointerEvents = 'none';
    } else {
      this.annotationLayerEl.style.pointerEvents = 'auto';
    }
  }

  // ---------------- PDF PAGE LOAD ----------------
  async loadPage() {
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

    this.pageDiv = pageView.div as HTMLElement;

    this.addAnnotationLayer();
    this.restoreAnnotations();
    this.drawCommentsFromProps();
  }

  // -------------- ANNOTATION LAYER ----------------
  addAnnotationLayer() {
    if (!this.pageDiv) return;

    const old = this.pageDiv.querySelector('.annotationLayer');
    if (old) old.remove();

    const annLayer = document.createElement('div');
    annLayer.classList.add('annotationLayer');

    Object.assign(annLayer.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '20',
      pointerEvents: this.activeTool === 'select' ? 'none' : 'auto',
    });

    annLayer.addEventListener('mousedown', this.onMouseDown.bind(this));
    annLayer.addEventListener('mousemove', this.onMouseMove.bind(this));
    annLayer.addEventListener('mouseup', this.onMouseUp.bind(this));

    this.pageDiv.appendChild(annLayer);
    this.annotationLayerEl = annLayer;
  }

  // -------------- HIGHLIGHT & COMMENT / NOTE CLICK ----------------
  onMouseDown(e: MouseEvent) {
    if (!this.annotationLayerEl) return;

    const layer = this.annotationLayerEl;
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Comment or Note creation
    if (this.activeTool === 'comment' || this.activeTool === 'note') {
      const nx = x / rect.width;
      const ny = y / rect.height;
      const kind: AnnotationKind = this.activeTool;
      this.commentAddRequested.emit({ page: this.page, x: nx, y: ny, kind });
      return;
    }

    // Highlight drawing
    if (this.activeTool !== 'highlight') return;

    this.isDrawing = true;
    this.startX = x;
    this.startY = y;

    this.currentRectEl = document.createElement('div');
    this.currentRectEl.className = 'annotationRect';

    Object.assign(this.currentRectEl.style, {
      position: 'absolute',
      left: `${x}px`,
      top: `${y}px`,
      backgroundColor: 'rgba(255,255,0,0.4)',
      borderRadius: '2px',
      pointerEvents: 'none',
    });

    layer.appendChild(this.currentRectEl);
  }

  onMouseMove(e: MouseEvent) {
    if (!this.isDrawing || !this.currentRectEl || !this.annotationLayerEl) return;

    const layer = this.annotationLayerEl;
    const rect = layer.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = x - this.startX;
    const h = y - this.startY;

    if (w > 0) this.currentRectEl.style.width = w + 'px';
    if (h > 0) this.currentRectEl.style.height = h + 'px';
  }

  onMouseUp() {
    if (this.activeTool !== 'highlight') return;

    this.isDrawing = false;
    if (!this.currentRectEl || !this.annotationLayerEl) return;

    const layerRect = this.annotationLayerEl.getBoundingClientRect();

    const w = parseFloat(this.currentRectEl.style.width);
    const h = parseFloat(this.currentRectEl.style.height);

    if (w > 2 && h > 2) {
      const rect: NormalizedRect = {
        x: parseFloat(this.currentRectEl.style.left) / layerRect.width,
        y: parseFloat(this.currentRectEl.style.top) / layerRect.height,
        width: w / layerRect.width,
        height: h / layerRect.height,
      };

      this.annotationCreated.emit({ page: this.page, rect });
    }

    this.currentRectEl = null;
  }

  // -------------- RESTORE HIGHLIGHTS ----------------
  restoreAnnotations() {
    if (!this.annotationLayerEl) return;

    const layerRect = this.annotationLayerEl.getBoundingClientRect();

    this.annotations.forEach((h) => {
      const rect = document.createElement('div');
      rect.className = 'annotationRect';

      Object.assign(rect.style, {
        position: 'absolute',
        left: h.x * layerRect.width + 'px',
        top: h.y * layerRect.height + 'px',
        width: h.width * layerRect.width + 'px',
        height: h.height * layerRect.height + 'px',
        backgroundColor: 'rgba(255,255,0,0.4)',
        borderRadius: '2px',
        pointerEvents: 'none',
      });

      this.annotationLayerEl!.appendChild(rect);
    });
  }

  // -------------- DRAW COMMENT / NOTE ICONS ----------------
  private drawCommentsFromProps() {
    if (!this.pageDiv) return;

    // Remove old icons
    this.pageDiv.querySelectorAll('.comment-icon').forEach((el) => el.remove());

    const rect = this.pageDiv.getBoundingClientRect();

    this.comments.forEach((c) => {
      const icon = document.createElement('div');
      icon.className = 'comment-icon';
      icon.textContent = c.kind === 'comment' ? '💬' : '📝';

      Object.assign(icon.style, {
        position: 'absolute',
        left: c.x * rect.width + 'px',
        top: c.y * rect.height + 'px',
        fontSize: '20px',
        cursor: 'pointer',
        zIndex: '30',
      });

      icon.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.commentIconClicked.emit({ page: this.page, commentId: c.id });
      });

      this.pageDiv!.appendChild(icon);
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
