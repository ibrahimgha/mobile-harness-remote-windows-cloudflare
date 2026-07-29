import { defaultSchema } from "rehype-sanitize";

const additionalBasicTags = ["bdi", "u"] as const;
const windowsDriveProtocols = Array.from({ length: 26 }, (_, index) =>
  String.fromCharCode(65 + index)
).flatMap((letter) => [letter, letter.toLowerCase()]);

export const messageHtmlSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...additionalBasicTags],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dir", "lang"]
  },
  protocols: {
    ...defaultSchema.protocols,
    // Windows paths are parsed as URL schemes (for example, "C:"). The
    // renderer still requires a valid absolute local path before opening it.
    href: [...(defaultSchema.protocols?.href ?? []), ...windowsDriveProtocols]
  }
};
