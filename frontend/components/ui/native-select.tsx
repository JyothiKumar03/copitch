import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const NativeSelect = ({ className, children, ...props }: ComponentProps<"select">) => (
  <div data-slot="native-select-wrapper" className="relative min-w-0">
    <select data-slot="native-select" className={cn("min-h-9 w-full appearance-none rounded-md border border-input bg-card py-2 pl-3 pr-8 text-sm text-foreground focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>
      {children}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  </div>
);

export const NativeSelectOption = (props: ComponentProps<"option">) => <option {...props} />;
