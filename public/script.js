/**
 * South African Economy Survey - Frontend JavaScript
 * Handles form validation, submission, and client-side logic
 */

(function() {
    'use strict';

    // ========================================
    // DOM Elements
    // ========================================
    const form = document.getElementById('survey-form');
    const submitButton = document.getElementById('submit-button');
    const formError = document.getElementById('form-error');
    const commentTextarea = document.getElementById('comment');
    const charCount = document.getElementById('char-count');

    // Storage key for duplicate prevention
    const STORAGE_KEY = 'survey_submitted_sa_economy';

    // Pages Function endpoint
    const API_SUBMIT_URL = '/submit';
    const COMMENT_MAX_LENGTH = 500;

    // ========================================
    // Initialize
    // ========================================
    function init() {
        if (!form) {
            console.error('Survey form not found');
            return;
        }

        // Check if already submitted (client-side duplicate prevention)
        if (localStorage.getItem(STORAGE_KEY)) {
            showAlreadySubmitted();
            return;
        }

        // Character counter for comment
        if (commentTextarea && charCount) {
            commentTextarea.addEventListener('input', updateCharCount);
            updateCharCount();
        }

        // Form validation on blur
        setupValidationOnBlur();

        // Form submission
        form.addEventListener('submit', handleSubmit);

        // Real-time validation feedback
        setupRealTimeValidation();
    }

    // ========================================
    // Character Counter
    // ========================================
    function updateCharCount() {
        if (!commentTextarea || !charCount) return;
        const count = commentTextarea.value.length;
        const max = commentTextarea.maxLength || COMMENT_MAX_LENGTH;
        charCount.textContent = `${count} / ${max} characters`;
    }

    // ========================================
    // Validation Setup
    // ========================================
    function setupValidationOnBlur() {
        const requiredFields = form.querySelectorAll('[required]:not([type="checkbox"])');
        requiredFields.forEach(field => {
            field.addEventListener('blur', () => validateField(field));
        });

        // For checkboxes (question 5)
        const checkboxes = form.querySelectorAll('input[name="cut_back_on"]');
        if (checkboxes.length > 0) {
            checkboxes.forEach(cb => {
                cb.addEventListener('change', validateCheckboxGroup);
            });
        }
    }

    function setupRealTimeValidation() {
        // Add input event listeners for immediate feedback
        const radioGroups = ['age_range', 'status', 'main_pressure', 'cost_increased', 
                            'work_worry_rating', 'income_keeps_up_rating', 'transport_cost', 'food_cost'];
        
        radioGroups.forEach(name => {
            const radios = form.querySelectorAll(`input[name="${name}"]`);
            radios.forEach(radio => {
                radio.addEventListener('change', () => validateField(radios[0]));
            });
        });
    }

    // ========================================
    // Field Validation
    // ========================================
    function validateField(field) {
        const fieldName = field.name;
        const errorElement = document.getElementById(`error-${fieldName}`);
        
        if (!errorElement) return true;

        // Get the actual value based on field type
        let value;
        if (field.type === 'radio') {
            value = form.querySelector(`input[name="${fieldName}"]:checked`)?.value;
        } else {
            value = field.value;
        }

        // Check required
        if (field.required && !value) {
            errorElement.textContent = 'This field is required';
            return false;
        }

        // Clear error if valid
        errorElement.textContent = '';
        return true;
    }

    function validateCheckboxGroup() {
        const checkboxes = form.querySelectorAll('input[name="cut_back_on"]:checked');
        const errorElement = document.getElementById('error-cut_back_on');
        
        if (!errorElement) return true;

        if (checkboxes.length === 0) {
            errorElement.textContent = 'Please select at least one option';
            return false;
        }

        errorElement.textContent = '';
        return true;
    }

    // ========================================
    // Form Validation
    // ========================================
    function validateForm() {
        let isValid = true;
        const firstInvalidField = null;

        // Validate all required fields
        const requiredFields = [
            'age_range', 'status', 'main_pressure', 'cost_increased',
            'work_worry_rating', 'income_keeps_up_rating', 'transport_cost', 'food_cost'
        ];

        requiredFields.forEach(fieldName => {
            const field = form.querySelector(`input[name="${fieldName}"]:checked`);
            const errorElement = document.getElementById(`error-${fieldName}`);
            
            if (!field && errorElement) {
                errorElement.textContent = 'This field is required';
                isValid = false;
                if (!firstInvalidField && errorElement) {
                    scrollToElement(errorElement);
                }
            } else if (errorElement) {
                errorElement.textContent = '';
            }
        });

        // Validate checkbox group (question 5)
        const checkboxes = form.querySelectorAll('input[name="cut_back_on"]:checked');
        const checkboxError = document.getElementById('error-cut_back_on');
        if (checkboxes.length === 0) {
            if (checkboxError) {
                checkboxError.textContent = 'Please select at least one option';
                isValid = false;
                if (!firstInvalidField) {
                    scrollToElement(checkboxError);
                }
            }
        } else if (checkboxError) {
            checkboxError.textContent = '';
        }

        // Validate comment length (optional but has max length)
        if (commentTextarea && commentTextarea.value.length > COMMENT_MAX_LENGTH) {
            const commentError = document.getElementById('error-comment');
            if (commentError) {
                commentError.textContent = `Comment is too long (max ${COMMENT_MAX_LENGTH} characters)`;
                isValid = false;
            }
        }

        // Clear general error if form is valid
        if (isValid && formError) {
            formError.textContent = '';
        }

        return isValid;
    }

    // ========================================
    // Form Submission
    // ========================================
    function handleSubmit(event) {
        event.preventDefault();
        event.stopPropagation();

        // Validate form
        if (!validateForm()) {
            if (formError) {
                formError.textContent = 'Please complete all required questions before submitting.';
            }
            return;
        }

        // Disable submit button
        setSubmitButtonState(true);

        // Collect form data
        const formData = collectFormData();

        // Submit to API
        submitFormData(formData);
    }

    function collectFormData() {
        return {
            age_range: getRadioValue('age_range'),
            status: getRadioValue('status'),
            main_pressure: getRadioValue('main_pressure'),
            cost_increased: getRadioValue('cost_increased'),
            cut_back_on: getCheckboxValues('cut_back_on'),
            work_worry_rating: getRadioValue('work_worry_rating'),
            income_keeps_up_rating: getRadioValue('income_keeps_up_rating'),
            transport_cost: getRadioValue('transport_cost'),
            food_cost: getRadioValue('food_cost'),
            comment: commentTextarea ? commentTextarea.value.trim() : null
        };
    }

    function getRadioValue(name) {
        const selected = form.querySelector(`input[name="${name}"]:checked`);
        return selected ? selected.value : null;
    }

    function getCheckboxValues(name) {
        const checkboxes = form.querySelectorAll(`input[name="${name}"]:checked`);
        return Array.from(checkboxes).map(cb => cb.value);
    }

    function submitFormData(data) {
        // Mark as submitting
        setSubmitButtonState(true);

        fetch(API_SUBMIT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(data),
            credentials: 'omit'
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => {
                    const detail = Array.isArray(err.details) && err.details.length > 0
                        ? err.details[0]
                        : null;
                    throw new Error(detail || err.error || err.message || 'Submission failed');
                });
            }
            return response.json();
        })
        .then(result => {
            // Success! Mark as submitted
            localStorage.setItem(STORAGE_KEY, 'true');
            
            // Redirect to success page
            window.location.href = '/success.html';
        })
        .catch(error => {
            console.error('Submission error:', error);
            
            // Show error message
            if (formError) {
                const message = error.message || 'An error occurred. Please try again.';
                formError.textContent = message;
            }
            
            // Re-enable submit button
            setSubmitButtonState(false);
        });
    }

    // ========================================
    // UI Helpers
    // ========================================
    function setSubmitButtonState(isLoading) {
        if (!submitButton) return;
        
        submitButton.disabled = isLoading;
        submitButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    }

    function scrollToElement(element, offset = -20) {
        if (!element) return;
        
        const elementPosition = element.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset + offset;
        
        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });
        
        // Focus the element for accessibility
        element.focus();
    }

    function showAlreadySubmitted() {
        // Show a message that the survey has already been submitted
        if (form) {
            form.innerHTML = `
                <div class="card" style="text-align: center; padding: 2rem;">
                    <h2 style="color: var(--color-black); margin-bottom: 1rem;">
                        Survey Already Submitted
                    </h2>
                    <p style="color: var(--color-charcoal); margin-bottom: 1.5rem;">
                        Thank you! You have already submitted this survey.
                    </p>
                    <p style="color: var(--color-grey);">
                        Each participant can only submit once to ensure data accuracy.
                    </p>
                </div>
            `;
        }
    }

    // ========================================
    // Initialize on DOM Ready
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
