import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[3px] border font-semibold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-studio-dark",
        outline: "border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-muted",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        ghost: "border-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 px-5 py-2.5 text-sm",
        sm: "min-h-9 px-3.5 py-2 text-sm",
        lg: "min-h-12 px-6 py-3 text-base",
        icon: "size-11 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type TButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = ({ asChild = false, className, variant, size, ...props }: TButtonProps) => {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
};
