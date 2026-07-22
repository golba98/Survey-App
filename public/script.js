(function () {
    'use strict';

    const form = document.getElementById('survey-form');
    const submitButton = document.getElementById('submit-button');
    const formError = document.getElementById('form-error');
    const commentTextarea = document.getElementById('comment');
    const charCount = document.getElementById('char-count');
    const turnstileContainer = document.getElementById('turnstile-widget');

    const STORAGE_KEY = 'survey_submitted_sa_economy';
    const COMMENT_MAX_LENGTH = 500;
    const REQUIRED_RADIO_GROUPS = [
        'age_range', 'status', 'main_pressure', 'cost_increased',
        'work_worry_rating', 'income_keeps_up_rating', 'transport_cost', 'food_cost'
    ];

    let turnstileWidgetId = null;
    let turnstileConfig = null;
    let pendingChallenge = null;

    function init() {
        if (!form) return;

        if (localStorage.getItem(STORAGE_KEY)) {
            showAlreadySubmitted();
            return;
        }

        commentTextarea?.addEventListener('input', updateCharCount);
        updateCharCount();
        setupValidation();
        form.addEventListener('submit', handleSubmit);
    }

    function updateCharCount() {
        if (!commentTextarea || !charCount) return;
        charCount.textContent = `${commentTextarea.value.length} / ${COMMENT_MAX_LENGTH} characters`;
    }

    function setupValidation() {
        for (const name of REQUIRED_RADIO_GROUPS) {
            form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
                input.addEventListener('change', () => setFieldError(name, ''));
            });
        }
        form.querySelectorAll('input[name="cut_back_on"]').forEach((input) => {
            input.addEventListener('change', () => setFieldError('cut_back_on', ''));
        });
    }

    function validateForm() {
        let firstInvalid = null;

        for (const name of REQUIRED_RADIO_GROUPS) {
            const selected = form.querySelector(`input[name="${name}"]:checked`);
            setFieldError(name, selected ? '' : 'This field is required');
            if (!selected && !firstInvalid) firstInvalid = form.querySelector(`input[name="${name}"]`);
        }

        const checkedBoxes = form.querySelectorAll('input[name="cut_back_on"]:checked');
        setFieldError('cut_back_on', checkedBoxes.length ? '' : 'Please select at least one option');
        if (!checkedBoxes.length && !firstInvalid) firstInvalid = form.querySelector('input[name="cut_back_on"]');

        const commentTooLong = Boolean(commentTextarea && commentTextarea.value.length > COMMENT_MAX_LENGTH);
        setFieldError('comment', commentTooLong ? `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer` : '');
        if (commentTooLong && !firstInvalid) firstInvalid = commentTextarea;

        if (firstInvalid) {
            firstInvalid.focus();
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            showFormError('Please complete all required questions before submitting.');
            return false;
        }

        showFormError('');
        return true;
    }

    function setFieldError(name, message) {
        const element = document.getElementById(`error-${name}`);
        if (element) element.textContent = message;
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (!validateForm() || submitButton?.disabled) return;

        setSubmitting(true);
        try {
            const turnstileToken = await requestTurnstileToken();
            const response = await fetch('/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(collectFormData(turnstileToken)),
                credentials: 'same-origin'
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) throw new Error(messageForResponse(response.status, result));

            localStorage.setItem(STORAGE_KEY, 'true');
            window.location.assign('/success.html');
        } catch (error) {
            showFormError(error instanceof Error ? error.message : 'Submission failed. Please try again.');
            resetTurnstile();
            setSubmitting(false);
        }
    }

    function collectFormData(turnstileToken) {
        return {
            age_range: getRadioValue('age_range'),
            status: getRadioValue('status'),
            main_pressure: getRadioValue('main_pressure'),
            cost_increased: getRadioValue('cost_increased'),
            cut_back_on: Array.from(form.querySelectorAll('input[name="cut_back_on"]:checked'), (input) => input.value),
            work_worry_rating: getRadioValue('work_worry_rating'),
            income_keeps_up_rating: getRadioValue('income_keeps_up_rating'),
            transport_cost: getRadioValue('transport_cost'),
            food_cost: getRadioValue('food_cost'),
            comment: commentTextarea?.value.trim() || null,
            turnstileToken
        };
    }

    function getRadioValue(name) {
        return form.querySelector(`input[name="${name}"]:checked`)?.value || null;
    }

    function messageForResponse(status, result) {
        if (status === 429) return 'Too many submissions from this network. Please try again later.';
        if (status === 503) return 'The security check or survey service is temporarily unavailable. Please try again in a few minutes.';
        if (status === 413) return 'The submission is too large. Please shorten your comment and try again.';
        return result.error || 'Submission failed. Please check your answers and try again.';
    }

    async function requestTurnstileToken() {
        await ensureTurnstileWidget();
        if (pendingChallenge) throw new Error('The security check is already running.');

        return new Promise((resolve, reject) => {
            pendingChallenge = { resolve, reject };
            try {
                window.turnstile.execute(turnstileWidgetId);
            } catch {
                pendingChallenge = null;
                reject(new Error('The security check could not start. Please try again.'));
            }
        });
    }

    async function ensureTurnstileWidget() {
        if (turnstileWidgetId !== null) return;
        if (!turnstileContainer) throw new Error('The security check is unavailable.');

        const [config] = await Promise.all([loadTurnstileConfig(), waitForTurnstile()]);
        turnstileConfig = config;
        turnstileWidgetId = window.turnstile.render(turnstileContainer, {
            sitekey: config.turnstileSiteKey,
            action: config.turnstileAction,
            appearance: 'interaction-only',
            execution: 'execute',
            theme: 'dark',
            callback: (token) => settleChallenge('resolve', token),
            'expired-callback': () => settleChallenge('reject', new Error('The security check expired. Please try again.')),
            'timeout-callback': () => settleChallenge('reject', new Error('The security check timed out. Please try again.')),
            'error-callback': () => settleChallenge('reject', new Error('The security check failed. Please try again.'))
        });
    }

    async function loadTurnstileConfig() {
        if (turnstileConfig) return turnstileConfig;
        const response = await fetch('/config', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!response.ok) throw new Error('The security check is temporarily unavailable. Please try again later.');
        const config = await response.json();
        if (!config.turnstileSiteKey || !config.turnstileAction) {
            throw new Error('The security check is not configured.');
        }
        return config;
    }

    function waitForTurnstile() {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const check = () => {
                if (window.turnstile?.render) return resolve();
                if (Date.now() - startedAt >= 7000) return reject(new Error('The security check could not load. Please try again.'));
                window.setTimeout(check, 100);
            };
            check();
        });
    }

    function settleChallenge(method, value) {
        const challenge = pendingChallenge;
        pendingChallenge = null;
        challenge?.[method](value);
    }

    function resetTurnstile() {
        pendingChallenge = null;
        if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
    }

    function setSubmitting(isSubmitting) {
        if (!submitButton) return;
        submitButton.disabled = isSubmitting;
        submitButton.setAttribute('aria-busy', String(isSubmitting));
    }

    function showFormError(message) {
        if (formError) formError.textContent = message;
    }

    function showAlreadySubmitted() {
        const card = document.createElement('div');
        card.className = 'card already-submitted-card';
        const heading = document.createElement('h2');
        heading.textContent = 'Survey Already Submitted in This Browser';
        const message = document.createElement('p');
        message.textContent = 'Thank you. This browser has already recorded a successful submission.';
        card.append(heading, message);
        form.replaceChildren(card);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}());
