// src/components/doc-workspace/doc-workspace.tsx
import { Component, h, State } from '@stencil/core';
import type { FileType } from '../doc-viewer/doc-viewer';

interface WorkspaceFile {
  id: string;
  name: string;
  url: string;
  fileType: FileType;
}

@Component({
  tag: 'doc-workspace',
  styleUrl: 'doc-workspace.css',
  shadow: false,
})
export class DocWorkspace {
  @State() files: WorkspaceFile[] = [];
  @State() activeId: string | null = null;

  // ⭐ Global theme state (affects viewer + workspace)
  @State() theme: 'light' | 'dark' | 'sepia' = 'light';

  private fileInput?: HTMLInputElement;

  // ------------------------------------------------------------
  // FILE UPLOAD
  // ------------------------------------------------------------
  private onFileSelected = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase();
    const id = Date.now().toString();

    let fileType: FileType = 'text';
    if (ext.endsWith('.pdf')) fileType = 'pdf';
    else if (ext.match(/\.(png|jpg|jpeg|gif|bmp|webp)$/)) fileType = 'image';

    const url = URL.createObjectURL(file);

    this.files = [
      ...this.files,
      {
        id,
        name: file.name,
        url,
        fileType,
      },
    ];

    this.activeId = id;
    input.value = '';
  };

  // ------------------------------------------------------------
  // CLOSE TAB
  // ------------------------------------------------------------
  private closeFile(id: string) {
    this.files = this.files.filter((f) => f.id !== id);

    if (this.activeId === id) {
      this.activeId = this.files.length ? this.files[0].id : null;
    }
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  render() {
    const activeFile = this.files.find((f) => f.id === this.activeId);

    return (
      <div class={`workspace-container theme-${this.theme}`}>

        {/* ------------------------ WORKSPACE TOOLBAR ------------------------- */}
        <div class="workspace-toolbar">
          <button class="open-btn" onClick={() => this.fileInput?.click()}>
            📂 Open File
          </button>

          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.bmp,.webp,.txt,.md"
            style={{ display: 'none' }}
            ref={(el) => (this.fileInput = el as HTMLInputElement)}
            onChange={this.onFileSelected}
          />

          <div class="toolbar-spacer"></div>

          {/* ⭐ THEME SWITCHER */}
          <label class="theme-label">Theme:</label>
          <select
            class="theme-select"
            onChange={(e: any) => {
              this.theme = e.target.value;
            }}
          >
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
        </div>

        {/* ------------------------ TABS ------------------------- */}
        <div class="workspace-tabs">
          {this.files.map((file) => (
            <div
              class={{
                tab: true,
                active: file.id === this.activeId,
              }}
              onClick={() => (this.activeId = file.id)}
            >
              {file.name}

              <span
                class="close-x"
                onClick={(ev) => {
                  ev.stopPropagation();
                  this.closeFile(file.id);
                }}
              >
                ✖
              </span>
            </div>
          ))}
        </div>

        {/* ------------------------ VIEWER PANEL ------------------------- */}
        <div class="workspace-viewer">
          {activeFile ? (
            <doc-viewer
              key={activeFile.id}
              src={activeFile.url}
              fileType={activeFile.fileType}
              scale={1.2}
              theme={this.theme}      // ⭐ PASS THEME TO VIEWER
              mode="editor"           // default for workspace
            ></doc-viewer>
          ) : (
            <div class="empty">
              No file opened. Click <b>Open File</b>.
            </div>
          )}
        </div>
      </div>
    );
  }
}
