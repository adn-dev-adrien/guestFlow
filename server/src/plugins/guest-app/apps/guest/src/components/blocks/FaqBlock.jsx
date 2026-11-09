/** FaqBlock — questions that open on their answer (rule 18 `faq`). */
export default function FaqBlock({ block }) {
  return (
    <div className="faq">
      {block.items.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
