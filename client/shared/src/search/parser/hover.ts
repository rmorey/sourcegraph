import * as Monaco from 'monaco-editor'
import { Token, toMonacoRange } from './scanner'
import { resolveFilter } from './filters'
import { decorateTokens, DecoratedToken, RegexpMetaKind } from './tokens'

const toHover = (token: DecoratedToken): string => {
    console.log(`token: ${JSON.stringify(token)}`)
    switch (token.type) {
        case 'regexpMeta': {
            console.log(`meta ${token.value}`)
            if (token.kind === RegexpMetaKind.Assertion) {
                return '**Assertion.** A regexp assertion.'
            }
        }
    }
    return ''
}

/**
 * Returns the hover result for a hovered search token in the Monaco query input.
 */
export const getHoverResult = (
    tokens: Token[],
    { column }: Pick<Monaco.Position, 'column'>
): Monaco.languages.Hover | null => {
    console.log(`I see column ${column}`)
    const tokensAtCursor = tokens.filter(({ range }) => range.start + 1 <= column && range.end >= column)
    if (tokensAtCursor.length === 0) {
        return null
    }
    const values: string[] = []
    let range: Monaco.IRange | undefined
    tokensAtCursor.map(token => {
        if (token.type === 'filter') {
            const resolvedFilter = resolveFilter(token.field.value)
            if (resolvedFilter) {
                values.push(
                    'negated' in resolvedFilter
                        ? resolvedFilter.definition.description(resolvedFilter.negated)
                        : resolvedFilter.definition.description
                )
                // range = toMonacoRange(token.range)
            }
            if (token.value) {
                const hovers = decorateTokens([token])
                    .slice(1)
                    .filter(({ range }) => range.start + 1 <= column && range.end >= column)
                    .map(toHover)
                console.log(`yep ${JSON.stringify(hovers)}`)
                values.push(...hovers)
            }
        }
    })
    return {
        contents: values.map<Monaco.IMarkdownString>(
            (value): Monaco.IMarkdownString => ({
                value,
            })
        ),
        range,
    }
}
