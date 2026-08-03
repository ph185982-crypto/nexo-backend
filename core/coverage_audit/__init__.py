"""
Coverage Audit — analyse question pool completeness for a given exam.

Public API::

    from core.coverage_audit import CoverageAuditor, CoverageReport

    auditor = CoverageAuditor(exam='PMGO')
    report = auditor.audit(questions=questions, subjects=subjects)
    print(report.as_dict())
"""
from .auditor import CoverageAuditor
from .models import CoverageFlag, CoverageReport, SubjectCoverage

__all__ = [
    "CoverageAuditor",
    "CoverageReport",
    "SubjectCoverage",
    "CoverageFlag",
]
