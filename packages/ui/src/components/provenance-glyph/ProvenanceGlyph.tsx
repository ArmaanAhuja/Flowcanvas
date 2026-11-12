import { classNames } from '../../class-names';
import styles from './ProvenanceGlyph.module.css';

export type GlyphProvenance = 'observed' | 'resolved' | 'convention' | 'suggested' | 'unknown';

/**
 * Graphite's provenance by line form only, never by colour (CLAUDE.md section 10): observed is a solid line with a
 * check mark; resolved and convention are solid lines (a connector's name goes beside convention, in words);
 * suggested is dotted; unknown is an open stub ending in a hollow circle. Always shown with the word beside it.
 */
export function ProvenanceGlyph({
  provenance,
  className,
}: {
  readonly provenance: GlyphProvenance;
  readonly className?: string;
}) {
  return (
    <svg className={classNames(styles.glyph, className)} viewBox="0 0 16 8" aria-hidden="true">
      {provenance === 'unknown' ? (
        <>
          <line x1="1" y1="4" x2="9" y2="4" />
          <circle cx="12" cy="4" r="2.5" />
        </>
      ) : provenance === 'suggested' ? (
        <line x1="1" y1="4" x2="15" y2="4" className={classNames(styles.dotted)} />
      ) : provenance === 'observed' ? (
        <>
          <line x1="1" y1="4" x2="8" y2="4" />
          <polyline points="9.5,4 11.5,6 15,1.5" />
        </>
      ) : (
        <line x1="1" y1="4" x2="15" y2="4" />
      )}
    </svg>
  );
}
