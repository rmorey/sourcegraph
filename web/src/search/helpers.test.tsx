import { getSearchTypeFromQuery, toggleSearchType, filterSearchSuggestions, insertSuggestionInQuery } from './helpers'
import { SearchType } from './results/SearchResults'
import { addTypeToSuggestions, baseSuggestions } from './getSearchFilterSuggestions'

describe('search/helpers', () => {
    describe('queryIndexOfScope()', () => {
        test.skip('should return the index of a scope if contained in the query', () => {
            /* noop */
        })
        test.skip('should return the index of a scope if at the beginning of the query', () => {
            /* noop */
        })
        test.skip('should return the -1 if the scope is not contained in the query', () => {
            /* noop */
        })
        test.skip('should return the -1 if the scope is contained as a substring of another scope', () => {
            /* noop */
        })
    })

    const searchTypes: SearchType[] = ['diff', 'commit', 'symbol', 'repo']

    describe('getSearchTypeFromQuery()', () => {
        test('parses the search type in simple queries', () => {
            for (const searchType of searchTypes) {
                expect(getSearchTypeFromQuery(`type:${searchType}`)).toEqual(searchType)
            }
        })

        test('returns null when no search type specified', () => {
            expect(getSearchTypeFromQuery('code')).toEqual(null)
        })

        test('parses the search type in complex queries', () => {
            expect(getSearchTypeFromQuery('test type:diff')).toEqual('diff')
            expect(getSearchTypeFromQuery('type:diff test')).toEqual('diff')
            expect(getSearchTypeFromQuery('repo:^github.com/sourcegraph/sourcegraph type:diff test')).toEqual('diff')
            expect(getSearchTypeFromQuery('type:diff repo:^github.com/sourcegraph/sourcegraph test')).toEqual('diff')
        })

        test('returns symbol when multiple search types, including symbol, are specified', () => {
            // Edge case. If there are multiple type filters and `type:symbol` is one of them, symbol results always get returned.
            expect(
                getSearchTypeFromQuery('type:diff type:symbol repo:^github.com/sourcegraph/sourcegraph test')
            ).toEqual('symbol')
        })

        test('returns the first search type specified when multiple search types, not including symbol, are specified', () => {
            expect(
                getSearchTypeFromQuery('type:diff type:commit repo:^github.com/sourcegraph/sourcegraph test')
            ).toEqual('diff')
        })
    })

    describe('toggleSearchType()', () => {
        test('returns the original query when the query already contains the correct type', () => {
            expect(toggleSearchType('test', null)).toEqual('test')

            for (const searchType of searchTypes) {
                expect(toggleSearchType(`test type:${searchType}`, searchType)).toEqual(`test type:${searchType}`)
            }
        })

        test('appends type:$TYPE to the query when no type exists in the query', () => {
            for (const searchType of searchTypes) {
                expect(toggleSearchType('test', searchType)).toEqual(`test type:${searchType}`)
            }
        })

        test('replaces existing type in query with new type in simple queries', () => {
            expect(toggleSearchType('test type:commit', 'diff')).toEqual('test type:diff')
            expect(toggleSearchType('type:diff test', 'commit')).toEqual('type:commit test')
        })

        test('replaces existing type in query with new type in complex queries', () => {
            expect(toggleSearchType('test type:symbol repo:^sourcegraph/test', 'diff')).toEqual(
                'test type:diff repo:^sourcegraph/test'
            )
            expect(toggleSearchType('test type:symbol repo:^sourcegraph/test', null)).toEqual(
                'test  repo:^sourcegraph/test'
            )
        })

        test('replaces the first type in query with new type in queries with multiple type fields', () => {
            expect(toggleSearchType('test type:symbol type:commit repo:^sourcegraph/test', 'diff')).toEqual(
                'test type:diff type:commit repo:^sourcegraph/test'
            )
        })
    })

    describe('suggestions', () => {
        const filterSuggestions = addTypeToSuggestions(baseSuggestions)
        const filterQuery = 'test re test'

        const getArchivedSuggestions = () => filterSearchSuggestions('archived:', 9, filterSuggestions)

        const getRepoFilterSuggestion = () =>
            filterSearchSuggestions(filterQuery, 7, filterSuggestions).filter(({ title }) => title === 'repo')[0]

        describe('filterSearchSuggestions', () => {
            test('filters suggestions for filters starting with "re"', () => {
                expect(getRepoFilterSuggestion().title).toBe('repo')
            })

            test('filters suggestions for word "test"', () => {
                const suggestions = filterSearchSuggestions(filterQuery, 4, filterSuggestions)
                expect(suggestions.length).toBe(0)
            })

            test('filters suggestions for the "archived:" filter', () => {
                const archivedSuggestions = getArchivedSuggestions()
                expect(archivedSuggestions).toEqual(expect.arrayContaining(filterSuggestions.archived.values))
            })
        })

        describe('insertSuggestionInQuery', () => {
            describe('inserts suggestions for a filter name', () => {
                const suggestion = getRepoFilterSuggestion()
                const [newQuery] = insertSuggestionInQuery('test re test', suggestion, 7)
                expect(newQuery).toBe(`test ${suggestion.title}: test`)
            })
            test('insets suggestion for a filter value', () => {
                const [suggestion] = getArchivedSuggestions()
                const [newQuery] = insertSuggestionInQuery('test archived: test', suggestion, 14)
                expect(newQuery).toBe(`test archived:${suggestion.title} test`)
            })
        })
    })
})
