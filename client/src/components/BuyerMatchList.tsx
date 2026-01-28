type BuyerMatch = {
  name: string;
  score: number;
  rationale: string;
};

interface BuyerMatchListProps {
  buyers: BuyerMatch[];
}

function clamp01(x: number) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export default function BuyerMatchList({ buyers }: BuyerMatchListProps) {
  return (
    <div className="section">
      <h3>Buyer matches</h3>
      <div className="buyers">
        {buyers.map((b, i) => {
          const pct = Math.round(clamp01(b.score) * 100);
          return (
            <div className="buyer" key={`${b.name}-${i}`}>
              <div className="buyerTop">
                <div className="buyerName">
                  <span className="rank">#{i + 1}</span> {b.name}
                </div>
                <div className="score">{pct}%</div>
              </div>

              <div className="scoreBar">
                <div className="scoreFill" style={{ width: `${pct}%` }} />
              </div>

              <div className="buyerWhy">{b.rationale}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
