interface DealSummaryProps {
  summary: string;
}

export default function DealSummary({ summary }: DealSummaryProps) {
  return (
    <div className="section">
      <h3>Analyst summary</h3>
      <div className="small">{summary}</div>
    </div>
  );
}
