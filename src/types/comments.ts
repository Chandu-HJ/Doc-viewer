export type AnnotationKind = 'comment' | 'note';

export interface PageComment {
  id: string;     // unique
  kind: AnnotationKind;
  x: number;      // absolute position px
  y: number;
  text: string;
  tag: string;
  createdAt: string;
}
