import { AppDialog } from "@/modules/ui/AppDialog";
import { AppButton } from "@/modules/ui/AppButton";

export function PracticeStopConfirmDialog({
  visible,
  title,
  message,
  continueLabel,
  finishLabel,
  onContinue,
  onFinish,
}: {
  visible: boolean;
  title: string;
  message: string;
  continueLabel: string;
  finishLabel: string;
  onContinue: () => void;
  onFinish: () => void;
}) {
  return (
    <AppDialog
      visible={visible}
      title={title}
      message={message}
      actions={
        <>
          <AppButton label={continueLabel} variant="secondary" onPress={onContinue} />
          <AppButton label={finishLabel} onPress={onFinish} />
        </>
      }
    />
  );
}
