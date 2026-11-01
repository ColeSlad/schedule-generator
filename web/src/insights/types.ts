export interface GradeSummary {
  average_gpa: number | null;
  letter_grade_gpa: number | null;
  graded_count: number;
  withdrawals: number;
  other_count: number;
  distribution: Record<string, number>;
  first_term: string | null;
  last_term: string | null;
}
export interface ProfessorInsight {
  requested_name: string;
  name: string;
  status: string;
  source: string | null;
  average_rating: number | null;
  review_count: number | null;
  course_rating: number | null;
  course_review_count: number | null;
  grades: GradeSummary | null;
  recent_review: {
    course: string | null;
    rating: number | null;
    created: string;
    excerpt: string;
  } | null;
  stale: boolean;
}
export interface CourseInsight {
  course: string;
  title: string;
  status: string;
  source: string;
  average_gpa: number | null;
  grades: GradeSummary | null;
  professors: ProfessorInsight[];
  fetched_at: string | null;
  stale: boolean;
}
export interface InsightRequest {
  courses: string[];
  instructors?: Record<string, string[]>;
}
export interface InsightResponse {
  courses: Record<string, CourseInsight>;
  warnings: string[];
}
