import { useState } from "react";

type OutreachDraft = {
  buyerName: string;
  emailSubject: string;
  emailBody: string;
};

interface OutreachDraftsProps {
  drafts: OutreachDraft[];
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function OutreachDrafts({ drafts }: OutreachDraftsProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function onCopy(key: string, text: string) {
    const ok = await copyToClipboard(text);
    setCopiedKey(ok ? key : null);
    if (ok) {
      window.setTimeout(() => setCopiedKey(null), 1100);
    }
  }

  return (
    <div className="section">
      <h3>Outreach drafts</h3>
      <div className="drafts">
        {drafts.map((d, i) => {
          const subjKey = `${d.buyerName}-subj`;
          const bodyKey = `${d.buyerName}-body`;
          return (
            <details className="draft" key={`${d.buyerName}-${i}`} open={i === 0}>
              <summary>
                <span className="draftTitle">{d.buyerName}</span>
                <span className="draftHint">Expand</span>
              </summary>

              <div className="draftInner">
                <div className="draftSubject">
                  <div className="draftRowTop">
                    <span>Subject</span>
                    <button
                      type="button"
                      className="mini"
                      onClick={() => onCopy(subjKey, d.emailSubject)}
                    >
                      {copiedKey === subjKey ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="small">{d.emailSubject}</div>
                </div>

                <div className="draftBody">
                  <div className="draftRowTop">
                    <span>Body</span>
                    <button
                      type="button"
                      className="mini"
                      onClick={() => onCopy(bodyKey, d.emailBody)}
                    >
                      {copiedKey === bodyKey ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="mono">{d.emailBody}</pre>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
