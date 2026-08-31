/**
 * The UI primitives, in shadcn's copy-in model.
 *
 * **This source is owned here, not vendored.** It is edited in place to meet
 * this repo's accessibility rules rather than kept pristine for a future
 * upstream diff — a file nobody may touch is a dependency wearing a copy's
 * clothes, and it would be touched the first time a screen reader needed
 * something upstream did not provide. Every such edit carries a comment saying
 * why, so the deviation is reviewable.
 *
 * Colours come from `theme/tokens.ts` via `tailwind.config.ts` (#111), so these
 * components and the SVG charts cannot disagree about the palette.
 */
export { Button, buttonTextVariants, buttonVariants, type ButtonProps } from './Button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './Card';
export { cn } from './cn';
export { FormMessage } from './FormMessage';
export { Input, type InputProps } from './Input';
export { Label } from './Label';
export { Text, TextClassContext, type TextProps } from './Text';
