import { useStore } from '../../stores';
import { AttachmentChip } from '../shared/AttachmentChip';

export function QuotedSelectionCard() {
  const quotedSelections = useStore(s => s.quotedSelections);
  const removeQuotedSelection = useStore(s => s.removeQuotedSelection);

  if (quotedSelections.length === 0) return null;

  return (
    <>
      {quotedSelections.map((selection, index) => (
        <AttachmentChip
          key={`${selection.sourceKind}:${selection.sourceFilePath || selection.sourceSessionPath || ''}:${selection.sourceMessageId || ''}:${selection.updatedAt || index}`}
          icon={<QuoteIcon />}
          name={selection.text}
          variant="quote"
          tooltip={<><strong>{selection.sourceKind === 'chat' ? (selection.sourceRole === 'user' ? '引用用户消息' : '引用助手回复') : selection.sourceTitle}</strong><br/>{selection.text}</>}
          removeLabel={`移除引用 ${index + 1}`}
          onRemove={() => removeQuotedSelection(index)}
        />
      ))}
    </>
  );
}

function QuoteIcon() {
  return (
    <svg
      data-icon="quote"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 6H4v7h6V6Zm0 7c0 4-2 6-5 7M21 6h-6v7h6V6Zm0 7c0 4-2 6-5 7" />
    </svg>
  );
}
