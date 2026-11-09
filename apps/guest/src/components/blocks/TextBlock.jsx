/**
 * TextBlock — rich text (rule 18 `text`): paragraphs, bold, italic, lists, links. The HTML is the server's,
 * already sanitised to that allow-list (`bookletBlocks.sanitizeRichText`).
 */
export default function TextBlock({ block }) {
  // eslint-disable-next-line react/no-danger
  return <div className="btext" dangerouslySetInnerHTML={{ __html: block.html || '' }} />;
}
