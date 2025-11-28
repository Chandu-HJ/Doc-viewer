import { Component, h, Prop, Element } from '@stencil/core';

const pdfjsLib = (window as any).pdfjsLib;
const pdfjsViewer = (window as any).pdfjsViewer;

pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.js';

@Component({
  tag: 'doc-page',
  styleUrl: 'doc-page.css',
  shadow: false
})
export class DocPage {
  @Element() host!: HTMLElement;

  @Prop() src!: string;
  @Prop() page: number = 1;
  @Prop() scale: number = 1.2;

  private viewerContainer!: HTMLDivElement;

  private activeTool: "select" | "highlight" = "select";
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRectEl: HTMLElement | null = null;

  // Store highlights per page
  private highlights: Record<number, any[]> = {};

  async componentDidLoad() {
    // Load saved annotations
    const saved = localStorage.getItem("pdf_annotations");
    if (saved) {
      this.highlights = JSON.parse(saved);
      console.log("Loaded annotations:", this.highlights);
    }

    await this.loadPage();
  }

  // --------------------------------------------
  // LOAD PAGE + ANNOTATION LAYER
  // --------------------------------------------
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
      textLayerMode: 2
    });

    pageView.setPdfPage(page);
    await pageView.draw();

    this.addAnnotationLayer(pageView);
    this.restoreHighlights(pageView);
  }

  // --------------------------------------------
  // CREATE ANNOTATION LAYER
  // --------------------------------------------
  addAnnotationLayer(pageView) {
    const pageDiv = pageView.div;

    // Remove old layer if exists (avoid duplicates)
    const old = pageDiv.querySelector(".annotationLayer");
    if (old) old.remove();

    const annLayer = document.createElement("div");
    annLayer.classList.add("annotationLayer");

    Object.assign(annLayer.style, {
      position: "absolute",
      inset: "0",
      zIndex: "20",
      pointerEvents: "none"
    });

    // Ensure layer is visible (fix previous 'hidden' issue)
    annLayer.hidden = false;
    annLayer.removeAttribute("hidden");

    // Bind events
    annLayer.addEventListener("mousedown", this.onMouseDown.bind(this));
    annLayer.addEventListener("mousemove", this.onMouseMove.bind(this));
    annLayer.addEventListener("mouseup", this.onMouseUp.bind(this));

    pageDiv.appendChild(annLayer);
  }

  // --------------------------------------------
  // DRAW HANDLERS
  // --------------------------------------------
  onMouseDown(e: MouseEvent) {
    if (this.activeTool !== "highlight") return;

    this.isDrawing = true;

    const layer = e.currentTarget as HTMLElement;
    const rect = layer.getBoundingClientRect();

    this.startX = e.clientX - rect.left;
    this.startY = e.clientY - rect.top;

    this.currentRectEl = document.createElement("div");
    this.currentRectEl.className = "annotationRect";

    Object.assign(this.currentRectEl.style, {
      position: "absolute",
      left: `${this.startX}px`,
      top: `${this.startY}px`,
      backgroundColor: "rgba(255,255,0,0.4)"
    });

    layer.appendChild(this.currentRectEl);
  }

  onMouseMove(e: MouseEvent) {
    if (!this.isDrawing || !this.currentRectEl) return;

    const layer = e.currentTarget as HTMLElement;
    const rect = layer.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = x - this.startX;
    const h = y - this.startY;

    if (w > 0) this.currentRectEl.style.width = w + "px";
    if (h > 0) this.currentRectEl.style.height = h + "px";
  }

  onMouseUp() {
    if (this.activeTool !== "highlight") return;

    this.isDrawing = false;

    if (this.currentRectEl) {
      const annLayer = this.currentRectEl.parentElement as HTMLElement;
      const layerRect = annLayer.getBoundingClientRect();

      const w = parseFloat(this.currentRectEl.style.width);
      const h = parseFloat(this.currentRectEl.style.height);

      if (w > 2 && h > 2) {
        const page = this.page;

        if (!this.highlights[page]) this.highlights[page] = [];

        const normalized = {
          x: parseFloat(this.currentRectEl.style.left) / layerRect.width,
          y: parseFloat(this.currentRectEl.style.top) / layerRect.height,
          width: w / layerRect.width,
          height: h / layerRect.height
        };

        this.highlights[page].push(normalized);

        localStorage.setItem("pdf_annotations", JSON.stringify(this.highlights));
        console.log("Saved highlight:", normalized);
      }

      this.currentRectEl = null;
    }
  }

  // --------------------------------------------
  // RESTORE HIGHLIGHTS ON REFRESH
  // --------------------------------------------
  restoreHighlights(pageView) {
    const pageNum = pageView.id;
    if (!this.highlights[pageNum]) return;

    const annLayer = pageView.div.querySelector(".annotationLayer") as HTMLElement;
    if (!annLayer) return;

    const layerRect = annLayer.getBoundingClientRect();

    this.highlights[pageNum].forEach(h => {
      const rect = document.createElement("div");
      rect.className = "annotationRect";

      Object.assign(rect.style, {
        position: "absolute",
        left: h.x * layerRect.width + "px",
        top: h.y * layerRect.height + "px",
        width: h.width * layerRect.width + "px",
        height: h.height * layerRect.height + "px",
        backgroundColor: "rgba(255,255,0,0.4)",
        borderRadius: "2px",
        pointerEvents: "none"
      });

      annLayer.appendChild(rect);
    });

    console.log("Restored highlights for page:", pageNum);
  }

  // --------------------------------------------
  // TOOLBAR
  // --------------------------------------------
  setTool(tool) {
    this.activeTool = tool;

    const layers = document.querySelectorAll<HTMLElement>(".annotationLayer");
    layers.forEach(layer => {
      layer.style.pointerEvents = tool === "highlight" ? "auto" : "none";
    });

    console.log("Tool selected:", tool);
  }

  // --------------------------------------------
  // RENDER
  // --------------------------------------------
  render() {
    return (
      <div class="viewer-container">
        <div class="toolbar">
          <button onClick={() => this.setTool("select")}>🖱 Select</button>
          <button onClick={() => this.setTool("highlight")}>🖍 Highlight</button>
        </div>

        <div class="viewer-wrapper">
          <div
            class="pdfViewer"
            ref={el => (this.viewerContainer = el as HTMLDivElement)}
          />
        </div>
      </div>
    );
  }
}
