window.downloadCsv = (filename, content) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.downloadPdf = (filename, reportJson) => {
  const report = JSON.parse(reportJson);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(18);
  doc.text("FADED. — Accounting Report", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(report.generatedAt, 14, y);
  y += 10;

  doc.setFontSize(13);
  doc.text("Summary", 14, y);
  y += 7;
  doc.setFontSize(10);
  for (const row of report.summary) {
    doc.text(`${row.label}: R${row.value}`, 14, y);
    y += 6;
  }
  y += 4;

  for (const section of report.sections) {
    if (y > 260) { doc.addPage(); y = 18; }
    doc.setFontSize(13);
    doc.text(section.title, 14, y);
    y += 7;
    doc.setFontSize(10);
    for (const row of section.rows) {
      if (y > 270) { doc.addPage(); y = 18; }
      doc.text(`${row.label}   R${row.amount}`, 14, y);
      y += 6;
    }
    y += 6;
  }

  doc.save(filename);
};
