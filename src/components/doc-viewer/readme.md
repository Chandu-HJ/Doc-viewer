# doc-viewer



<!-- Auto Generated Below -->


## Properties

| Property           | Attribute   | Description | Type                           | Default     |
| ------------------ | ----------- | ----------- | ------------------------------ | ----------- |
| `embedded`         | `embedded`  |             | `boolean`                      | `false`     |
| `fileType`         | `file-type` |             | `"image" \| "pdf" \| "text"`   | `'pdf'`     |
| `mode`             | `mode`      |             | `"editor" \| "viewer"`         | `'editor'`  |
| `scale`            | `scale`     |             | `number`                       | `1.2`       |
| `src` _(required)_ | `src`       |             | `string`                       | `undefined` |
| `theme`            | `theme`     |             | `"dark" \| "light" \| "sepia"` | `'light'`   |


## Dependencies

### Used by

 - [doc-workspace](../doc-workspace)

### Depends on

- [doc-page](../doc-page)

### Graph
```mermaid
graph TD;
  doc-viewer --> doc-page
  doc-workspace --> doc-viewer
  style doc-viewer fill:#f9f,stroke:#333,stroke-width:4px
```

----------------------------------------------

*Built with [StencilJS](https://stenciljs.com/)*
