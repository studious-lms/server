// -----------------------------
// Basic format enums and interfaces
// -----------------------------
export enum FormatTypes {
    HEADER_1,
    HEADER_2,
    HEADER_3,
    HEADER_4,
    HEADER_5,
    HEADER_6,
    PARAGRAPH,
    BULLET,
    NUMBERED,
    TABLE,
    IMAGE,
    CODE_BLOCK,
    QUOTE,
}


// Each content block in a document
export interface DocumentBlock {
    format: FormatTypes;
    content: string | string[]; // can be text, list items, etc. string as html / mrkdown
    metadata?: Record<string, any>; // optional extra formatting info (e.g. alignment)
}
