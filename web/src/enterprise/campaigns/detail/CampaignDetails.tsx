import { parse as parseJSONC } from '@sqs/jsonc-parser'
import { LoadingSpinner } from '@sourcegraph/react-loading-spinner'
import AlertCircleIcon from 'mdi-react/AlertCircleIcon'
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as GQL from '../../../../../shared/src/graphql/schema'
import { HeroPage } from '../../../components/HeroPage'
import { PageTitle } from '../../../components/PageTitle'
import { UserAvatar } from '../../../user/UserAvatar'
import { Timestamp } from '../../../components/time/Timestamp'
import { isEqual, noop } from 'lodash'
import { Form } from '../../../components/Form'
import {
    fetchCampaignById,
    updateCampaign,
    deleteCampaign,
    createCampaign,
    previewCampaignPlan,
    fetchCampaignPlanById,
    CampaignType,
    retryCampaign,
    closeCampaign,
} from './backend'
import { useError, useObservable } from '../../../util/useObservable'
import { asError } from '../../../../../shared/src/util/errors'
import * as H from 'history'
import { CampaignBurndownChart } from './BurndownChart'
import { AddChangesetForm } from './AddChangesetForm'
import { Subject, of, timer, merge, Observable } from 'rxjs'
import { renderMarkdown } from '../../../../../shared/src/util/markdown'
import { ErrorAlert } from '../../../components/alerts'
import { Markdown } from '../../../../../shared/src/components/Markdown'
import { Link } from '../../../../../shared/src/components/Link'
import { switchMap, tap, catchError, takeWhile, concatMap, repeatWhen, delay } from 'rxjs/operators'
import { ThemeProps } from '../../../../../shared/src/theme'
import { isDefined } from '../../../../../shared/src/util/types'
import { CampaignStatusBadge } from '../common/CampaignStatusBadge'
import { CloseDeleteCampaignPrompt } from './form/CloseDeleteCampaignPrompt'
import { CampaignStatus } from './CampaignStatus'
import { MANUAL_CAMPAIGN_TYPE, CampaignPlanSpecificationFormData } from './form/CampaignPlanSpecificationFields'
import { isExistingPlanID } from './new/NewCampaignForm'
import { CampaignTabs } from './CampaignTabs'

interface Props extends ThemeProps {
    /**
     * The campaign ID.
     * If not given, will display a creation form.
     */
    campaignID?: GQL.ID
    authenticatedUser: Pick<GQL.IUser, 'id' | 'username' | 'avatarURL'>
    history: H.History
    location: H.Location

    /** For testing only. */
    _fetchCampaignById?: typeof fetchCampaignById
}

/**
 * The area for a single campaign.
 */
export const CampaignDetails: React.FunctionComponent<Props> = ({
    campaignID,
    history,
    location,
    authenticatedUser,
    isLightTheme,
    _fetchCampaignById = fetchCampaignById,
}) => {
    // State for the form in editing mode
    const [name, setName] = useState<string>('')
    const [description, setDescription] = useState<string>('')

    const [campaignPlanSpec, setCampaignPlanSpec] = useState<CampaignPlanSpecificationFormData>()

    const [closeChangesets, setCloseChangesets] = useState<boolean>(false)

    // For errors during fetching
    const triggerError = useError()

    const campaignUpdates = useMemo(() => new Subject<void>(), [])

    const changesetUpdates = useMemo(() => new Subject<void>(), [])
    const nextChangesetUpdate = useCallback(changesetUpdates.next.bind(changesetUpdates), [changesetUpdates])

    // Fetch campaign if ID was given
    const [campaign, setCampaign] = useState<GQL.ICampaign | GQL.ICampaignPlan | null>()
    useEffect(() => {
        if (!campaignID) {
            return
        }
        const subscription = merge(of(undefined), campaignUpdates)
            .pipe(
                switchMap(
                    () =>
                        new Observable<GQL.ICampaign | null>(observer => {
                            let currentCampaign: GQL.ICampaign | null
                            const subscription = _fetchCampaignById(campaignID)
                                .pipe(
                                    tap(campaign => {
                                        currentCampaign = campaign
                                    }),
                                    repeatWhen(obs =>
                                        obs.pipe(
                                            // todo(a8n): why does this not unsubscribe when takeWhile is in outer pipe
                                            takeWhile(
                                                () =>
                                                    !!currentCampaign &&
                                                    !!currentCampaign.changesetCreationStatus &&
                                                    currentCampaign.changesetCreationStatus.state ===
                                                        GQL.BackgroundProcessState.PROCESSING
                                            ),
                                            delay(2000)
                                        )
                                    )
                                )
                                .subscribe(observer)
                            return subscription
                        })
                )
            )
            .subscribe({
                next: fetchedCampaign => {
                    setCampaign(fetchedCampaign)
                    setCampaignPlanSpec({
                        type: fetchedCampaign?.plan?.type as CampaignType,
                        arguments: fetchedCampaign?.plan ? fetchedCampaign.plan.arguments : null,
                    })
                    nextChangesetUpdate()
                },
                error: triggerError,
            })
        return () => subscription.unsubscribe()
    }, [campaignID, triggerError, nextChangesetUpdate, campaignUpdates, _fetchCampaignById])

    const [mode, setMode] = useState<'viewing' | 'editing' | 'saving' | 'deleting' | 'closing'>(
        campaignID ? 'viewing' : 'editing'
    )

    // To report errors from saving or deleting
    const [alertError, setAlertError] = useState<Error>()

    // To unblock the history after leaving edit mode
    const unblockHistoryRef = useRef<H.UnregisterCallback>(noop)
    useEffect(() => {
        if (!campaignID) {
            unblockHistoryRef.current()
            unblockHistoryRef.current = history.block('Do you want to discard this campaign?')
        }
        return unblockHistoryRef.current
    }, [campaignID, history])

    if (campaign === undefined && campaignID) {
        return <LoadingSpinner className="icon-inline mx-auto my-4" />
    }
    if (campaign === null) {
        return <HeroPage icon={AlertCircleIcon} title="Campaign not found" />
    }

    const onSubmit: React.FormEventHandler = async event => {
        event.preventDefault()
        setMode('saving')
        try {
            if (campaignID) {
                setCampaign(await updateCampaign({ id: campaignID, name, description }))
                unblockHistoryRef.current()
            } else {
                const createdCampaign = await createCampaign({
                    name,
                    description,
                    namespace: authenticatedUser.id,
                    plan: campaign && campaign.__typename === 'CampaignPlan' ? campaign.id : undefined,
                })
                unblockHistoryRef.current()
                history.push(`/campaigns/${createdCampaign.id}`)
            }
            setMode('viewing')
            setAlertError(undefined)
        } catch (err) {
            setMode('editing')
            setAlertError(asError(err))
        }
    }

    const discardChangesMessage = 'Do you want to discard your changes?'

    const onEdit: React.MouseEventHandler = event => {
        event.preventDefault()
        unblockHistoryRef.current = history.block(discardChangesMessage)
        {
            const { name, description, plan } = campaign as GQL.ICampaign
            setName(name)
            setDescription(description)
            setMode('editing')
            setCampaignPlanSpec({ type: plan?.type as CampaignType, arguments: plan?.arguments || '' })
        }
    }

    const onCancel: React.FormEventHandler = event => {
        event.preventDefault()
        if (!confirm(discardChangesMessage)) {
            return
        }
        unblockHistoryRef.current()
        setMode('viewing')
        setAlertError(undefined)
    }

    const onClose = async (): Promise<void> => {
        if (!confirm('Are you sure you want to close the campaign?')) {
            return
        }
        setMode('closing')
        try {
            await closeCampaign(campaign!.id, closeChangesets)
            campaignUpdates.next()
        } catch (err) {
            setAlertError(asError(err))
        } finally {
            setMode('viewing')
        }
    }

    const onDelete = async (): Promise<void> => {
        if (!confirm('Are you sure you want to delete the campaign?')) {
            return
        }
        setMode('deleting')
        try {
            await deleteCampaign(campaign!.id, closeChangesets)
            history.push('/campaigns')
        } catch (err) {
            setAlertError(asError(err))
        } finally {
            setMode('viewing')
        }
    }

    const onRetry = async (): Promise<void> => {
        try {
            await retryCampaign(campaign!.id)
            campaignUpdates.next()
        } catch (err) {
            setAlertError(asError(err))
        }
    }

    const author = campaign && campaign.__typename === 'Campaign' ? campaign.author : authenticatedUser

    const status = campaign
        ? campaign.__typename === 'CampaignPlan'
            ? campaign.status
            : campaign.changesetCreationStatus
        : null

    return (
        <>
            <PageTitle title={campaign && campaign.__typename === 'Campaign' ? campaign.name : 'New campaign'} />
            <Form onSubmit={onSubmit} onReset={onCancel} className="e2e-campaign-form">
                <nav className="mb-2" aria-label="breadcrumb">
                    <ol className="breadcrumb">
                        <li className="breadcrumb-item">
                            <Link to="/campaigns" className="text-decoration-none">
                                Campaigns
                            </Link>
                        </li>
                        <li className="breadcrumb-item active" aria-current="page">
                            New
                        </li>
                    </ol>
                </nav>
                <header className="d-flex mb-2">
                    {campaign && campaign.__typename === 'Campaign' && <h2 className="m-0">{campaign.name}</h2>}
                    <span className="flex-grow-1 d-flex justify-content-end align-items-center">
                        {(mode === 'saving' || mode === 'deleting' || mode === 'closing') && (
                            <LoadingSpinner className="mr-2" />
                        )}
                    </span>
                </header>
                {campaign && campaign.__typename === 'Campaign' && (
                    <header className="d-flex align-items-center mb-2">
                        <CampaignStatusBadge campaign={campaign} className="mr-2" />
                        <div className="flex-grow-1" />
                        {campaignID &&
                            (mode === 'editing' || mode === 'saving' ? (
                                <>
                                    <button type="submit" className="btn btn-primary mr-1" disabled={mode === 'saving'}>
                                        Save
                                    </button>
                                    <button type="reset" className="btn btn-secondary" disabled={mode === 'saving'}>
                                        Cancel
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        id="e2e-campaign-edit"
                                        className="btn btn-secondary mr-1"
                                        onClick={onEdit}
                                        disabled={mode === 'deleting' || mode === 'closing'}
                                    >
                                        Edit
                                    </button>
                                    {campaign && campaign.__typename === 'Campaign' && (
                                        <>
                                            {!campaign.closedAt && (
                                                <details className="campaign-details__details">
                                                    <summary>
                                                        <span className="btn btn-secondary mr-1 dropdown-toggle">
                                                            Close
                                                        </span>
                                                    </summary>
                                                    <CloseDeleteCampaignPrompt
                                                        message={
                                                            <p>
                                                                Close campaign <b>{campaign.name}</b>?
                                                            </p>
                                                        }
                                                        changesetsCount={campaign.changesets.totalCount}
                                                        closeChangesets={closeChangesets}
                                                        onCloseChangesetsToggle={setCloseChangesets}
                                                        buttonText="Close"
                                                        onButtonClick={onClose}
                                                        buttonClassName="btn-secondary"
                                                        buttonDisabled={mode === 'deleting' || mode === 'closing'}
                                                        className="position-absolute campaign-details__details-menu"
                                                    />
                                                </details>
                                            )}
                                            <details className="campaign-details__details">
                                                <summary>
                                                    <span className="btn btn-danger dropdown-toggle">Delete</span>
                                                </summary>
                                                <CloseDeleteCampaignPrompt
                                                    message={
                                                        <p>
                                                            Delete campaign <b>{campaign.name}</b>?
                                                        </p>
                                                    }
                                                    changesetsCount={campaign.changesets.totalCount}
                                                    closeChangesets={closeChangesets}
                                                    onCloseChangesetsToggle={setCloseChangesets}
                                                    buttonText="Delete"
                                                    onButtonClick={onDelete}
                                                    buttonClassName="btn-danger"
                                                    buttonDisabled={mode === 'deleting' || mode === 'closing'}
                                                    className="position-absolute campaign-details__details-menu"
                                                />
                                            </details>
                                        </>
                                    )}
                                </>
                            ))}
                    </header>
                )}
                {alertError && <ErrorAlert error={alertError} />}
                {campaign && campaign.__typename === 'Campaign' && (
                    <div className="card">
                        <div className="card-header">
                            <strong>
                                <UserAvatar user={author} className="icon-inline" /> {author.username}
                            </strong>{' '}
                            started <Timestamp date={campaign.createdAt} />
                        </div>
                        <div className="card-body">
                            <Markdown dangerousInnerHTML={renderMarkdown(campaign.description)}></Markdown>
                        </div>
                    </div>
                )}
            </Form>

            {/* Status asserts on campaign being set, so `campaign` will never be null. */}
            {status && <CampaignStatus campaign={campaign!} status={status} onRetry={onRetry} />}

            {campaign && campaign.__typename === 'Campaign' && (
                <>
                    <h3>Progress</h3>
                    <CampaignBurndownChart
                        changesetCountsOverTime={campaign.changesetCountsOverTime}
                        history={history}
                    />
                    {/* only campaigns that have no plan can add changesets manually */}
                    {!campaign.plan && <AddChangesetForm campaignID={campaign.id} onAdd={nextChangesetUpdate} />}
                </>
            )}
            {/* is already created or a preview is available */}
            {campaign && (
                <CampaignTabs
                    changesets={campaign.changesets}
                    persistLines={campaign.__typename === 'Campaign'}
                    history={history}
                    location={location}
                    className="mt-3"
                    isLightTheme={isLightTheme}
                />
            )}
        </>
    )
}
