/** HoursBlock — an opening-times table (rule 18 `hours`): labels and values as written in the studio. */
export default function HoursBlock({ block }) {
  return (
    <div className="hours">
      {block.title ? <h3>{block.title}</h3> : null}
      <ul>{block.rows.map((row) => <li key={row.label}><span>{row.label}</span><span>{row.value}</span></li>)}</ul>
    </div>
  );
}
