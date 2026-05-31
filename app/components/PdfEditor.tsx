import { useEffect, useRef, useState, useCallback } from "react";

const FONTS = [
  { label: "Helvetica", value: "Helvetica" },
  { label: "Helvetica Bold", value: "Helvetica-Bold" },
  { label: "Helvetica Oblique (Italic)", value: "Helvetica-Oblique" },
  { label: "Helvetica Bold Oblique", value: "Helvetica-BoldOblique" },
  { label: "Courier", value: "Courier" },
  { label: "Courier Bold", value: "Courier-Bold" },
  { label: "Courier Oblique", value: "Courier-Oblique" },
  { label: "Times Roman", value: "Times-Roman" },
  { label: "Times Bold", value: "Times-Bold" },
  { label: "Times Italic", value: "Times-Italic" },
  { label: "Times Bold Italic", value: "Times-BoldItalic" },
];

const FONT_CSS_MAP: Record<string, string> = {
  "Helvetica": "Helvetica, Arial, sans-serif",
  "Helvetica-Bold": "Helvetica, Arial, sans-serif",
  "Helvetica-Oblique": "Helvetica, Arial, sans-serif",
  "Helvetica-BoldOblique": "Helvetica, Arial, sans-serif",
  "Courier": "Courier, 'Courier New', monospace",
  "Courier-Bold": "Courier, 'Courier New', monospace",
  "Courier-Oblique": "Courier, 'Courier New', monospace",
  "Times-Roman": "Times, 'Times New Roman', serif",
  "Times-Bold": "Times, 'Times New Roman', serif",
  "Times-Italic": "Times, 'Times New Roman', serif",
  "Times-BoldItalic": "Times, 'Times New Roman', serif",
};

function getFontWeight(fontFamily: string): string {
  if (fontFamily.includes("Bold")) return "bold";
  return "normal";
}

function getFontStyle(fontFamily: string): string {
  if (fontFamily.includes("Oblique") || fontFamily.includes("Italic")) return "italic";
  return "normal";
}

export interface FieldMapping {
  id?: string;
  fieldLabel: string;
  page: number;
  x: number;
  y: number;
  fontSize: number;
  fontColor: string;
  fontFamily: string;
  maxWidth: number | null;
}

interface PdfEditorProps {
  pdfBase64: string;
  mappings: FieldMapping[];
  availableFields: string[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
}

export default function PdfEditor({ pdfBase64, mappings, availableFields, onMappingsChange }: PdfEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [pageWidth, setPageWidth] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragInfo = useRef<{ index: number; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Load PDF using pdfjs-dist
  useEffect(() => {
    if (!pdfBase64) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadPdf() {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

        const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
      } catch (err: any) {
        if (!cancelled) setError("Error cargando el PDF: " + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [pdfBase64]);

  // Render page on canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        setPageWidth(page.getViewport({ scale: 1 }).width);
        setPageHeight(page.getViewport({ scale: 1 }).height);
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
      } catch (err: any) {
        if (!cancelled) setError("Error renderizando la página: " + err.message);
      }
    }

    renderPage();
    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, scale]);

  // Convert canvas coords → PDF coords
  const canvasToPdf = useCallback((cx: number, cy: number) => {
    return {
      x: parseFloat((cx / scale).toFixed(2)),
      y: parseFloat((pageHeight - cy / scale).toFixed(2)),
    };
  }, [scale, pageHeight]);

  // Convert PDF coords → canvas coords
  const pdfToCanvas = useCallback((px: number, py: number) => {
    return {
      cx: px * scale,
      cy: (pageHeight - py) * scale,
    };
  }, [scale, pageHeight]);

  // Handle mouse down on overlay (start drag or click empty space to deselect)
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setSelectedIndex(null);
    }
  };

  // Handle drag start on a field chip
  const handleFieldMouseDown = (e: React.MouseEvent<HTMLDivElement>, index: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedIndex(index);

    const mapping = mappings[index];
    const { cx, cy } = pdfToCanvas(mapping.x, mapping.y);
    dragInfo.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      origX: cx,
      origY: cy,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragInfo.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dx = ev.clientX - dragInfo.current.startX;
      const dy = ev.clientY - dragInfo.current.startY;
      const newCx = Math.max(0, dragInfo.current.origX + dx);
      const newCy = Math.max(0, dragInfo.current.origY + dy);
      const { x, y } = canvasToPdf(newCx, newCy);

      const updated = mappings.map((m, i) =>
        i === dragInfo.current!.index ? { ...m, x, y } : m
      );
      onMappingsChange(updated);
    };

    const handleMouseUp = () => {
      dragInfo.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const addField = () => {
    const label = availableFields.find(f => !mappings.some(m => m.fieldLabel === f)) || "";
    const newMapping: FieldMapping = {
      fieldLabel: label,
      page: currentPage - 1,
      x: 50,
      y: pageHeight - 100,
      fontSize: 14,
      fontColor: "#000000",
      fontFamily: "Helvetica",
      maxWidth: null,
    };
    const updated = [...mappings, newMapping];
    onMappingsChange(updated);
    setSelectedIndex(updated.length - 1);
  };

  const removeField = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    onMappingsChange(updated);
    setSelectedIndex(null);
  };

  const updateSelected = (key: keyof FieldMapping, value: any) => {
    if (selectedIndex === null) return;
    const updated = mappings.map((m, i) =>
      i === selectedIndex ? { ...m, [key]: value } : m
    );
    onMappingsChange(updated);
  };

  const currentPageMappings = mappings
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.page === currentPage - 1);

  const sel = selectedIndex !== null ? mappings[selectedIndex] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "8px 12px",
        backgroundColor: "#f6f6f7",
        borderRadius: "8px",
        border: "1px solid #e1e3e5",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={toolbarBtnStyle(currentPage <= 1)}
          >◀</button>
          <span style={{ fontSize: "13px", color: "#202223", whiteSpace: "nowrap" }}>
            Página {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={toolbarBtnStyle(currentPage >= totalPages)}
          >▶</button>
        </div>

        <div style={{ width: "1px", height: "24px", backgroundColor: "#e1e3e5" }} />

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button type="button" onClick={() => setScale(s => Math.max(0.5, parseFloat((s - 0.2).toFixed(1))))} style={toolbarBtnStyle(false)}>🔍−</button>
          <span style={{ fontSize: "13px", color: "#202223", minWidth: "45px", textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale(s => Math.min(3, parseFloat((s + 0.2).toFixed(1))))} style={toolbarBtnStyle(false)}>🔍+</button>
        </div>

        <div style={{ width: "1px", height: "24px", backgroundColor: "#e1e3e5" }} />

        <button
          type="button"
          onClick={addField}
          style={{
            padding: "6px 14px",
            fontSize: "13px",
            fontWeight: "500",
            borderRadius: "6px",
            border: "1px solid #008060",
            backgroundColor: "#008060",
            color: "#ffffff",
            cursor: "pointer",
          }}
        >
          + Añadir campo
        </button>

        {loading && <span style={{ fontSize: "12px", color: "#6d7175" }}>Cargando PDF...</span>}
        {error && <span style={{ fontSize: "12px", color: "#d72c0d" }}>{error}</span>}
      </div>

      {/* Editor area */}
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        {/* Canvas + overlay */}
        <div
          ref={containerRef}
          style={{
            position: "relative",
            border: "1px solid #babfc3",
            borderRadius: "4px",
            overflow: "hidden",
            flex: "1",
            minWidth: 0,
            cursor: "default",
            backgroundColor: "#525659",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          <div style={{ position: "relative" }}>
            <canvas ref={canvasRef} style={{ display: "block" }} />

            {/* Field overlay */}
            <div
              onMouseDown={handleOverlayMouseDown}
              style={{
                position: "absolute",
                top: 0, left: 0, right: 0, bottom: 0,
              }}
            >
              {currentPageMappings.map(({ m, i }) => {
                const { cx, cy } = pdfToCanvas(m.x, m.y);
                const isSelected = i === selectedIndex;
                return (
                  <div
                    key={i}
                    onMouseDown={(e) => handleFieldMouseDown(e, i)}
                    title={`${m.fieldLabel}\nX: ${m.x.toFixed(1)}, Y: ${m.y.toFixed(1)}`}
                    style={{
                      position: "absolute",
                      left: cx,
                      top: cy,
                      transform: "translateY(-100%)",
                      padding: "2px 6px",
                      backgroundColor: isSelected ? "rgba(0, 128, 96, 0.85)" : "rgba(0, 100, 200, 0.75)",
                      color: "#ffffff",
                      borderRadius: "4px",
                      fontSize: `${Math.max(10, m.fontSize * scale * 0.85)}px`,
                      fontFamily: FONT_CSS_MAP[m.fontFamily] || "sans-serif",
                      fontWeight: getFontWeight(m.fontFamily),
                      fontStyle: getFontStyle(m.fontFamily),
                      cursor: "grab",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                      border: isSelected ? "2px solid #008060" : "2px solid rgba(0, 100, 200, 0.5)",
                      boxShadow: isSelected ? "0 0 0 3px rgba(0,128,96,0.3)" : "none",
                      maxWidth: m.maxWidth ? `${m.maxWidth * scale}px` : undefined,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {m.fieldLabel || "Campo vacío"}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Properties panel */}
        <div style={{
          width: "260px",
          minWidth: "260px",
          border: "1px solid #e1e3e5",
          borderRadius: "8px",
          backgroundColor: "#f6f6f7",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid #e1e3e5",
            backgroundColor: "#ffffff",
            fontSize: "13px",
            fontWeight: "600",
            color: "#202223",
          }}>
            {sel ? `Campo: "${sel.fieldLabel || "Sin nombre"}"` : "Selecciona un campo"}
          </div>

          {sel ? (
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Field label */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={labelStyle}>Nombre del campo</label>
                <select
                  value={sel.fieldLabel}
                  onChange={(e) => updateSelected("fieldLabel", e.target.value)}
                  style={inputStyle}
                >
                  <option value="">-- Seleccionar --</option>
                  {availableFields.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              {/* Font family */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={labelStyle}>Fuente</label>
                <select
                  value={sel.fontFamily || "Helvetica"}
                  onChange={(e) => updateSelected("fontFamily", e.target.value)}
                  style={inputStyle}
                >
                  {FONTS.map(f => (
                    <option key={f.value} value={f.value} style={{ fontFamily: FONT_CSS_MAP[f.value] }}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Font size */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={labelStyle}>Tamaño de fuente: {sel.fontSize}pt</label>
                <input
                  type="range"
                  min="6"
                  max="72"
                  step="1"
                  value={sel.fontSize}
                  onChange={(e) => updateSelected("fontSize", parseFloat(e.target.value))}
                  style={{ width: "100%", cursor: "pointer" }}
                />
                <input
                  type="number"
                  min="6"
                  max="72"
                  value={sel.fontSize}
                  onChange={(e) => updateSelected("fontSize", parseFloat(e.target.value) || 12)}
                  style={{ ...inputStyle, width: "70px" }}
                />
              </div>

              {/* Font color */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={labelStyle}>Color del texto</label>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="color"
                    value={sel.fontColor || "#000000"}
                    onChange={(e) => updateSelected("fontColor", e.target.value)}
                    style={{ width: "44px", height: "36px", padding: "2px", border: "1px solid #babfc3", borderRadius: "4px", cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={sel.fontColor || "#000000"}
                    onChange={(e) => updateSelected("fontColor", e.target.value)}
                    style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
                    placeholder="#000000"
                  />
                </div>
              </div>

              {/* Max width */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={labelStyle}>Ancho máximo (pts)</label>
                <input
                  type="number"
                  value={sel.maxWidth === null ? "" : sel.maxWidth}
                  onChange={(e) => updateSelected("maxWidth", e.target.value ? parseFloat(e.target.value) : null)}
                  placeholder="Sin límite"
                  style={inputStyle}
                />
                <span style={{ fontSize: "11px", color: "#6d7175" }}>
                  El texto se partirá en múltiples líneas si supera este ancho.
                </span>
              </div>

              {/* Coordinates (read-only display) */}
              <div style={{
                padding: "8px",
                backgroundColor: "#ffffff",
                borderRadius: "6px",
                border: "1px solid #e1e3e5",
                fontSize: "12px",
                color: "#6d7175",
                fontFamily: "monospace",
              }}>
                X: {sel.x.toFixed(1)}  Y: {sel.y.toFixed(1)} (pág. {sel.page + 1})
              </div>

              {/* Delete */}
              <button
                type="button"
                onClick={() => removeField(selectedIndex!)}
                style={{
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: "500",
                  borderRadius: "6px",
                  border: "1px solid #babfc3",
                  backgroundColor: "#ffffff",
                  color: "#d72c0d",
                  cursor: "pointer",
                  marginTop: "4px",
                }}
              >
                Eliminar campo
              </button>
            </div>
          ) : (
            <div style={{
              padding: "24px 14px",
              textAlign: "center",
              color: "#6d7175",
              fontSize: "13px",
              lineHeight: "1.5",
            }}>
              Haz clic en un campo del PDF para editarlo, o añade uno nuevo con el botón de arriba.
              <br /><br />
              <span style={{ fontSize: "11px" }}>Arrastra los campos para posicionarlos.</span>
            </div>
          )}

          {/* Fields list */}
          {mappings.length > 0 && (
            <div style={{ borderTop: "1px solid #e1e3e5", padding: "10px 14px" }}>
              <div style={{ fontSize: "12px", fontWeight: "600", color: "#6d7175", marginBottom: "6px" }}>TODOS LOS CAMPOS</div>
              {mappings.map((m, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setSelectedIndex(i);
                    setCurrentPage(m.page + 1);
                  }}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    color: "#202223",
                    cursor: "pointer",
                    backgroundColor: i === selectedIndex ? "#e3f1ef" : "transparent",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span>{m.fieldLabel || "(sin nombre)"}</span>
                  <span style={{ color: "#6d7175", fontSize: "11px" }}>pág.{m.page + 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toolbarBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: "13px",
    borderRadius: "4px",
    border: "1px solid #babfc3",
    backgroundColor: disabled ? "#f6f6f7" : "#ffffff",
    color: disabled ? "#babfc3" : "#202223",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: "500",
  color: "#202223",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: "13px",
  border: "1px solid #babfc3",
  borderRadius: "4px",
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: "#ffffff",
};
