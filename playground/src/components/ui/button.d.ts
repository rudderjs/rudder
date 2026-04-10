import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { type VariantProps } from "class-variance-authority";
declare const buttonVariants: (props?: ({
    variant?: "default" | "link" | "outline" | "secondary" | "ghost" | "destructive" | null | undefined;
    size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare function Button({ className, variant, size, ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): import("react/jsx-runtime").JSX.Element;
export { Button, buttonVariants };
//# sourceMappingURL=button.d.ts.map