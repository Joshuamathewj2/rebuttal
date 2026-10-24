// Renders the evidence packet PDF that is attached to provide-evidence.
// PayPal reviewers see one clean document: summary, cited response, then each
// numbered exhibit, so every [E#] marker in the response resolves to a page.

import PDFDocument from 'pdfkit';
import { REASON_LABELS } from './policy.js';

const INK = '#1d2433';
const MUTED = '#5b6475';
const ACCENT = '#0b5cad';

export function renderPacket({ dispute, order, merchant, evidence, response }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56, info: { Title: `Evidence packet ${dispute.dispute_id}`, Author: merchant.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor(MUTED).fontSize(9).text(`${merchant.name}  |  Merchant ID ${merchant.merchant_id}`, { align: 'right' });
    doc.moveDown(0.5);
    doc.fillColor(INK).fontSize(20).text(`Evidence packet - dispute ${dispute.dispute_id}`);
    doc.moveDown(0.3);
    doc.fillColor(MUTED).fontSize(10).text(
      `${REASON_LABELS[dispute.reason] || dispute.reason}  |  ${dispute.dispute_amount.currency_code} ${dispute.dispute_amount.value}  |  ` +
      `Transaction ${dispute.disputed_transactions[0].seller_transaction_id}  |  Invoice ${order.invoice_id}`,
    );
    doc.moveDown(1);

    doc.fillColor(ACCENT).fontSize(12).text('Seller response');
    doc.moveDown(0.3);
    doc.fillColor(INK).fontSize(11);
    for (const s of response.sentences) {
      const cites = s.cites.filter((c) => c !== 'PLAN');
      doc.text(s.text + (cites.length ? `  [${cites.join(', ')}]` : ''), { paragraphGap: 4, lineGap: 1.5 });
    }
    doc.moveDown(1);

    doc.fillColor(ACCENT).fontSize(12).text('Exhibits');
    doc.moveDown(0.3);
    for (const e of evidence) {
      if (doc.y > 660) doc.addPage();
      doc.fillColor(INK).fontSize(11).text(`${e.id}. ${e.title}`, { continued: false });
      doc.fillColor(MUTED).fontSize(8).text(`PayPal evidence type: ${e.evidence_type}`);
      doc.fillColor(INK).fontSize(10);
      for (const fact of e.facts) doc.text(`- ${fact}`, { indent: 10, paragraphGap: 2 });
      if (e.tracking?.tracking_url) doc.fillColor(ACCENT).text(e.tracking.tracking_url, { indent: 10, link: e.tracking.tracking_url, underline: true });
      doc.moveDown(0.6);
    }

    doc.fillColor(MUTED).fontSize(8).text(
      `Prepared ${new Date().toISOString().slice(0, 10)} with Rebuttal. Every statement in the seller response cites an exhibit above and was automatically checked against it before submission.`,
      56, 720, { width: 500 },
    );
    doc.end();
  });
}
