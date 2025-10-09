import { PDFDocument, PDFFont, RGB, StandardFonts, rgb } from 'pdf-lib'
import { writeFile } from 'fs'
import { DocumentBlock, FormatTypes } from './jsonStyles'

export async function createPdf(blocks: DocumentBlock[]) {
    const pdfDoc = await PDFDocument.create()
    const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman)
    const courierFont = await pdfDoc.embedFont(StandardFonts.Courier)
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const defaultFont = helveticaFont
    const defaultParagraphSpacing = 10;

    const headingColor = rgb(0.1, 0.1, 0.1)
    const paragraphColor = rgb(0.15, 0.15, 0.15)

    const STYLE_PRESETS: Record<number,
    {fontSize: number; lineHeight: number; paragraphSpacing?: number; font?: PDFFont; color?: RGB; background?: RGB }> =
    {
        [FormatTypes.HEADER_1]: { fontSize: 28, lineHeight: 28 * 1.35, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.HEADER_2]: { fontSize: 22, lineHeight: 22 * 1.35, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.HEADER_3]: { fontSize: 18, lineHeight: 18 * 1.35, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.HEADER_4]: { fontSize: 16, lineHeight: 16 * 1.3, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.HEADER_5]: { fontSize: 14, lineHeight: 14 * 1.3, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.HEADER_6]: { fontSize: 12, lineHeight: 12 * 1.3, font: helveticaBoldFont, color: headingColor },
        [FormatTypes.QUOTE]: { fontSize: 14, lineHeight: 14 * 1.5, color: rgb(0.35, 0.35, 0.35) },
        [FormatTypes.CODE_BLOCK]: { fontSize: 12, lineHeight: 12 * 1.6, font: courierFont, color: rgb(0.1, 0.1, 0.1), background: rgb(0.95, 0.95, 0.95) },
        [FormatTypes.PARAGRAPH]: { fontSize: 12, lineHeight: 12 * 1.3, color: paragraphColor },
        [FormatTypes.BULLET]: { fontSize: 12, lineHeight: 12 * 1.3, color: paragraphColor },
        [FormatTypes.NUMBERED]: { fontSize: 12, lineHeight: 12 * 1.3, color: paragraphColor },
        [FormatTypes.TABLE]: { fontSize: 12, lineHeight: 12 * 1.3, color: paragraphColor },
        [FormatTypes.IMAGE]: { fontSize: 12, lineHeight: 12 * 1.3 },
    }

    const hexToRgb = (hex) => {
        if (hex.length == 7) {
            const r = parseInt(hex.slice(1, 3), 16) / 255.0;
            const g = parseInt(hex.slice(3, 5), 16) / 255.0;
            const b = parseInt(hex.slice(5, 7), 16) / 255.0;
            return rgb(r, g, b);
        } else if (hex.length == 4) {
            const r = parseInt(hex.slice(1, 2), 16) / 15.0;
            const g = parseInt(hex.slice(2, 3), 16) / 15.0;
            const b = parseInt(hex.slice(3, 4), 16) / 15.0;
            return rgb(r, g, b);
        } else {return rgb(0.0, 0.0, 0.0)};
    };

    const colorParse = (color) => {
        if (typeof color === 'string') {
            return hexToRgb(color)
        } else {
            return color
        }
    }

    let page = pdfDoc.addPage()
    let { width, height } = page.getSize()
    const { marginTop, marginBottom, marginLeft, marginRight } = { marginTop: 50, marginBottom: 50, marginLeft: 50, marginRight: 50 }

    const maxTextWidth = () => width - marginLeft - marginRight

    const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
        if (!text) return ['']
        const words = text.split(/\s+/)
        const lines: string[] = []
        let current = ''

        const measure = (t: string) => font.widthOfTextAtSize(t, fontSize)

        const pushCurrent = () => {
            if (current.length > 0) {
                lines.push(current)
                current = ''
            }
        }

        for (let i = 0; i < words.length; i++) {
            const word = words[i]
            if (current.length === 0) {
                // If a single word is too long, hard-break it
                if (measure(word) > maxWidth) {
                    let chunk = ''
                    for (const ch of word) {
                        const test = chunk + ch
                        if (measure(test) > maxWidth && chunk.length > 0) {
                            lines.push(chunk)
                            chunk = ch
                        } else {
                            chunk = test
                        }
                    }
                    current = chunk
                } else {
                    current = word
                }
            } else {
                const test = current + ' ' + word
                if (measure(test) <= maxWidth) {
                    current = test
                } else {
                    pushCurrent()
                    // start new line with this word; hard-break if needed
                    if (measure(word) > maxWidth) {
                        let chunk = ''
                        for (const ch of word) {
                            const t2 = chunk + ch
                            if (measure(t2) > maxWidth && chunk.length > 0) {
                                lines.push(chunk)
                                chunk = ch
                            } else {
                                chunk = t2
                            }
                        }
                        current = chunk
                    } else {
                        current = word
                    }
                }
            }
        }
        pushCurrent()
        return lines
    }

    let y = height - marginTop
    let lastLineHeight = 0
    for (const block of blocks) {
        const preset = STYLE_PRESETS[block.format] || { fontSize: 12, lineHeight: 12 * 1.3 }

        const userLineHeight = (block as any).metadata?.lineHeight

        const fontSize = (block as any).metadata?.fontSize || preset.fontSize
        const lineHeight = Math.ceil((userLineHeight ? fontSize * userLineHeight : preset.lineHeight))
        const paragraphSpacing = (block as any).metadata?.paragraphSpacing || defaultParagraphSpacing

        const font = (block as any).metadata?.font || preset.font || defaultFont
        const color = colorParse((block as any).metadata?.color || preset.color || rgb(0.0, 0.0, 0.0))
        const background = colorParse((block as any).metadata?.background || preset.background || rgb(1.0, 1.0, 1.0))

        y -= lineHeight - lastLineHeight

        const ensureSpace = (needed: number) => {
            if (y - needed < marginBottom) {
                page = pdfDoc.addPage()
                    ; ({ width, height } = page.getSize())
                y = height - marginTop
            }
        }

        const drawParagraph = (text: string) => {
            const lines = wrapText(text, font, fontSize, maxTextWidth())
            for (const line of lines) {
                ensureSpace(lineHeight)
                page.drawText(line, {
                    x: marginLeft,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                y -= lineHeight
            }
        }

        const drawHeading = (text: string, align?: 'left' | 'center' | 'right') => {
            const lines = wrapText(text, font, fontSize, maxTextWidth())
            for (const line of lines) {
                ensureSpace(lineHeight)
                let x = marginLeft
                if (align === 'center') {
                    const tw = font.widthOfTextAtSize(line, fontSize)
                    x = marginLeft + (maxTextWidth() - tw) / 2
                } else if (align === 'right') {
                    const tw = font.widthOfTextAtSize(line, fontSize)
                    x = marginLeft + maxTextWidth() - tw
                }
                page.drawText(line, {
                    x,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                y -= lineHeight
            }
        }

        const drawBulletList = (items: string[]) => {
            const bulletIndent = 14
            const gap = 8
            const contentWidth = maxTextWidth() - (bulletIndent + gap)
            for (const item of items) {
                const lines = wrapText(item, font, fontSize, contentWidth)
                ensureSpace(lineHeight)
                // Bullet glyph
                page.drawText('•', {
                    x: marginLeft + 2,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                // First line
                page.drawText(lines[0], {
                    x: marginLeft + bulletIndent + gap,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                y -= lineHeight
                // Continuation lines with hanging indent
                for (let i = 1; i < lines.length; i++) {
                    ensureSpace(lineHeight)
                    page.drawText(lines[i], {
                        x: marginLeft + bulletIndent + gap,
                        y: y,
                        size: fontSize,
                        font: font,
                        color: color,
                    })
                    y -= lineHeight
                }
            }
        }

        const drawNumberedList = (items: string[]) => {
            const numberIndent = 18
            const gap = 8
            const contentWidth = maxTextWidth() - (numberIndent + gap)
            let index = 1
            for (const item of items) {
                const numLabel = `${index}.`
                const numWidth = font.widthOfTextAtSize(numLabel, fontSize)
                const lines = wrapText(item, font, fontSize, contentWidth)
                ensureSpace(lineHeight)
                page.drawText(numLabel, {
                    x: marginLeft,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                page.drawText(lines[0], {
                    x: marginLeft + Math.max(numberIndent, numWidth + 6) + gap,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                y -= lineHeight
                for (let i = 1; i < lines.length; i++) {
                    ensureSpace(lineHeight)
                    page.drawText(lines[i], {
                        x: marginLeft + Math.max(numberIndent, numWidth + 6) + gap,
                        y: y,
                        size: fontSize,
                        font: font,
                        color: color,
                    })
                    y -= lineHeight
                }
                index++
            }
        }

        const drawQuote = (text: string) => {
            const ruleWidth = 2
            const ruleGap = 8
            const contentX = marginLeft + ruleWidth + ruleGap
            const contentWidth = maxTextWidth() - (ruleWidth + ruleGap)
            const lines = wrapText(text, font, fontSize, contentWidth)
            const totalHeight = lines.length * lineHeight
            ensureSpace(totalHeight)
            page.drawRectangle({
                x: marginLeft,
                y: y - totalHeight + (lineHeight - fontSize),
                width: ruleWidth,
                height: totalHeight,
                color: color,
            })
            for (const line of lines) {
                page.drawText(line, {
                    x: contentX,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: color,
                })
                y -= lineHeight
            }
        }

        const drawCodeBlock = (textLines: string[]) => {
            const paddingY = Math.round(fontSize * 0.6)
            const paddingX = Math.round(fontSize * 0.6)
            const codeFont = preset.font || courierFont
            // Wrap each input line separately to preserve line breaks
            const wrappedLines: string[] = []
            const contentW = maxTextWidth() - paddingX * 2
            for (const l of textLines) {
                const parts = wrapText(l, codeFont, fontSize, contentW)
                wrappedLines.push(...parts)
            }
            const blockHeight = wrappedLines.length * lineHeight + paddingY * 2
            ensureSpace(blockHeight)
            page.drawRectangle({
                x: marginLeft,
                y: y - blockHeight + lineHeight,
                width: maxTextWidth(),
                height: blockHeight,
                color: background,
            })
            let innerY = y - paddingY
            for (const wl of wrappedLines) {
                page.drawText(wl, {
                    x: marginLeft + paddingX,
                    y: innerY,
                    size: fontSize,
                    font: codeFont,
                    color: color,
                })
                innerY -= lineHeight
            }
            y -= blockHeight
        }

        // Render by block format
        switch (block.format) {
            case FormatTypes.HEADER_1:
            case FormatTypes.HEADER_2:
            case FormatTypes.HEADER_3:
            case FormatTypes.HEADER_4:
            case FormatTypes.HEADER_5:
            case FormatTypes.HEADER_6: {
                const align = (block as any).metadata?.align as 'left' | 'center' | 'right' | undefined
                drawHeading(String(block.content), align)
                break
            }
            case FormatTypes.BULLET: {
                const items = Array.isArray(block.content) ? block.content.map(String) : [String(block.content)]
                drawBulletList(items)
                break
            }
            case FormatTypes.NUMBERED: {
                const items = Array.isArray(block.content) ? block.content.map(String) : [String(block.content)]
                drawNumberedList(items)
                break
            }
            case FormatTypes.QUOTE: {
                drawQuote(String(block.content))
                break
            }
            case FormatTypes.CODE_BLOCK: {
                const lines = Array.isArray(block.content) ? block.content.map(String) : String(block.content).split('\n')
                drawCodeBlock(lines)
                break
            }
            default: {
                if (typeof block.content === 'string') {
                    drawParagraph(block.content)
                } else {
                    for (const c of block.content) {
                        drawParagraph(String(c))
                    }
                }
            }
        }
        y -= paragraphSpacing
        lastLineHeight = lineHeight
    }

    const pdfBytes = await pdfDoc.save()
    writeFile('output.pdf', pdfBytes, () => {
        console.log('PDF created successfully')
    })
}
