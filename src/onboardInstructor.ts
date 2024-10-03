import { type JSONSchemaType } from 'ajv';

type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

interface ServiceEssentials {
	serviceName: string;
	durationInMinutes: number;
	price: number;
	priceCurrency: string;
}

interface HoursForDay {
	startTime24hr: string;
	endTime24hr: string;
	dayOfWeek: DayOfWeek;
}

export interface OnboardTenantEssentials {
	businessName: string;
	firstServices: ServiceEssentials;
	businessHours: HoursForDay[];
	yourEmailAddress: string;
	doYouWantUsToTakePaymentsDirectlyFromYourCustomers: boolean;
}

export const onboardInstructorEssentialsSchema: JSONSchemaType<OnboardTenantEssentials> = {
  type: 'object',
  properties: {
    businessName: {
      type: 'string'
    },
    firstServices: {
      type: 'object',
      properties: {
        serviceName: {
          type: 'string'
        },
        price: {
          type: 'number'
        },
        priceCurrency: {
          type: 'string'
        },
        durationInMinutes: {
          type: 'number'
        }
      },
      required: ['serviceName', 'price', 'priceCurrency', 'durationInMinutes'],
      additionalProperties: false
    },
    businessHours: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startTime24hr: {
            type: 'string'
          },
          endTime24hr: {
            type: 'string'
          },
          dayOfWeek: {
            type: 'string',
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
          }
        },
        required: ['startTime24hr', 'endTime24hr', 'dayOfWeek'],
        additionalProperties: false
      }
    },
    yourEmailAddress: {
      'type': 'string',
      'format': 'email'
    },
    doYouWantUsToTakePaymentsDirectlyFromYourCustomers: {
      type: 'boolean'
    }
  },
  required: ['businessName', 'firstServices', 'businessHours', 'yourEmailAddress', 'doYouWantUsToTakePaymentsDirectlyFromYourCustomers'],
  additionalProperties: false
};
