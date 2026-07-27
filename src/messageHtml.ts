import { defaultSchema } from "rehype-sanitize";

const additionalBasicTags = ["bdi", "u"] as const;

export const messageHtmlSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...additionalBasicTags],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "dir", "lang"]
  }
};
