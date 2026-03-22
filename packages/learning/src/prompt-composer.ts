/**
 * Prompt composer — V2-20.
 * Assembles final prompt strings from reusable sections stored in a
 * PromptRegistry and injects context variables (user metadata, task metadata)
 * into {{variable}} placeholders.
 *
 * Sections are identified by template keys and can be composed in order.
 * The composer falls back to a provided default when a section is missing
 * from the registry, so compositions remain functional even during
 * development when templates are not yet registered.
 */

import type { PromptRegistry } from "./prompt-registry.js";

export interface CompositionSection {
  /** Template key to look up in the registry. */
  templateKey: string;
  /** Fallback text used when the key is not found or has no active version. */
  fallback?: string;
}

export interface CompositionConfig {
  /** Ordered list of sections to concatenate. */
  sections: CompositionSection[];
  /** Separator inserted between sections (default: newline). */
  separator?: string;
}

export interface ComposedPrompt {
  text: string;
  /** Template keys that were found and used (excludes fallbacks). */
  resolvedKeys: string[];
  /** Template keys that fell back to the provided default. */
  fallbackKeys: string[];
  composedAt: Date;
}

export interface PromptComposerConfig {
  /** Global separator between sections. Can be overridden per composition. */
  defaultSeparator?: string;
}

/**
 * Resolves {{variable}} placeholders in a template string using the provided
 * context map.  Unknown placeholders are left as-is.
 */
function interpolate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = context[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Context-aware prompt composer.
 *
 * Usage:
 * ```ts
 * const composer = new PromptComposer(registry);
 * const prompt = composer.compose(
 *   { sections: [{ templateKey: "system-role" }, { templateKey: "task-summarise" }] },
 *   { userName: "Alice", language: "en" },
 * );
 * ```
 */
export class PromptComposer {
  private readonly registry: PromptRegistry;
  private readonly defaultSeparator: string;

  constructor(registry: PromptRegistry, config: PromptComposerConfig = {}) {
    this.registry = registry;
    this.defaultSeparator = config.defaultSeparator ?? "\n\n";
  }

  /**
   * Assemble a prompt from the given composition config, injecting the
   * provided context variables into each section.
   */
  compose(config: CompositionConfig, context: Record<string, unknown> = {}): ComposedPrompt {
    const separator = config.separator ?? this.defaultSeparator;
    const parts: string[] = [];
    const resolvedKeys: string[] = [];
    const fallbackKeys: string[] = [];

    for (const section of config.sections) {
      const activeTemplate = this.registry.getActiveTemplate(section.templateKey);

      if (activeTemplate !== null) {
        parts.push(interpolate(activeTemplate, context));
        resolvedKeys.push(section.templateKey);
      } else if (section.fallback !== undefined) {
        parts.push(interpolate(section.fallback, context));
        fallbackKeys.push(section.templateKey);
      }
      // If neither template nor fallback is available, skip this section silently
    }

    return {
      text: parts.join(separator),
      resolvedKeys,
      fallbackKeys,
      composedAt: new Date(),
    };
  }

  /**
   * Compose a single-section prompt (convenience wrapper).
   */
  composeSingle(
    templateKey: string,
    context: Record<string, unknown> = {},
    fallback?: string
  ): ComposedPrompt {
    return this.compose({ sections: [{ templateKey, fallback }] }, context);
  }

  /**
   * Render a raw template string with variable interpolation without
   * accessing the registry.  Useful for one-off templates.
   */
  render(template: string, context: Record<string, unknown> = {}): string {
    return interpolate(template, context);
  }
}
