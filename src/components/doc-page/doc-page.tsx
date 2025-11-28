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

  async componentDidLoad() {
    await this.loadPage();
  }

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
  }

  render() {
    return (
      <div class="viewer-wrapper">
        <div class="pdfViewer" ref={el => (this.viewerContainer = el as HTMLDivElement)}></div>
      </div>
    );
  }
}
