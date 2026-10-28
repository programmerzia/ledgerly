import { Toaster as Sonner, toast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast w-[320px] group-[.toaster]:bg-surface-elevated group-[.toaster]:text-text-primary group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-md group-[.toaster]:text-xs group-[.toaster]:p-3 flex items-center gap-2',
          description: 'group-[.toast]:text-text-muted text-[11px]',
          actionButton:
            'group-[.toast]:bg-accent group-[.toast]:text-white group-[.toast]:rounded-sm group-[.toast]:text-xs group-[.toast]:px-2 group-[.toast]:py-1',
          cancelButton:
            'group-[.toast]:bg-surface-neutral group-[.toast]:text-text-muted group-[.toast]:rounded-sm group-[.toast]:text-xs',
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
